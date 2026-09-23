import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppRuntime } from '../app.js';
import { AppError } from '../domain/errors.js';
import { TICKET_STATUSES, TICKET_TYPES } from '../domain/status.js';
import type { Status, TicketType } from '../domain/status.js';
import type { TicketService } from '../domain/ticket-service.js';

/** zod 校验失败统一转 VALIDATION(400)，details 携带字段级错误 */
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      'VALIDATION',
      '请求参数校验失败',
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** query 参数预处理：空字符串视为未传（前端筛选器清空场景） */
const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const idParams = z.object({ id: z.coerce.number().int().positive() });

// 建单：BLOCKER/DREAM 暂不接受创建（枚举收窄为 400）
const createBody = z.object({
  type: z.enum(['STORY', 'TASK']),
  title: z.string().min(1),
  description: z.string().optional(),
  parentId: z.number().int().positive().optional(),
  /** 预绑定 worker（仅 TASK；编排链拆单场景，自动放行前提） */
  workerId: z.string().optional(),
});

const listQuery = z.object({
  status: emptyAsUndefined(z.enum(TICKET_STATUSES)).optional(),
  type: emptyAsUndefined(z.enum(TICKET_TYPES)).optional(),
});

// 编辑仅 DRAFT 态可用；至少提供一个字段
const patchBody = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    specContent: z.string().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: '至少提供一个字段' });

const specBody = z.object({ specContent: z.string().min(1, 'spec 内容不能为空') });

const transitionBody = z.object({
  to: z.enum(TICKET_STATUSES),
  note: z.string().optional(),
  /** TASK 放行时绑定的 worker（user 白名单边外均为 system 通道） */
  workerId: z.string().min(1).optional(),
});

const commentBody = z.object({ content: z.string().min(1, '留言内容不能为空') });

const dependencyBody = z.object({ blockedByTicketId: z.number().int().positive() });

const dependencyParams = z.object({
  id: z.coerce.number().int().positive(),
  blockedById: z.coerce.number().int().positive(),
});

export function registerTicketRoutes(
  app: FastifyInstance,
  service: TicketService,
  runtime?: AppRuntime,
): void {
  // POST /api/tickets —— 建单（初始态 DRAFT）
  app.post('/api/tickets', async (req, reply) => {
    const body = parse(createBody, req.body);
    const ticket = service.createTicket(body);
    return reply.code(201).send(ticket);
  });

  // GET /api/tickets?status=&type= —— 列表（createdAt DESC）
  app.get('/api/tickets', async (req) => {
    const query = parse(listQuery, req.query);
    return { items: service.listTickets(query as { status?: Status; type?: TicketType }) };
  });

  // GET /api/tickets/:id —— 详情聚合（+编排层补充：workerName / 当前轮 spawn 时间）
  app.get('/api/tickets/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const detail = service.getTicketDetail(id);
    const workerName = detail.ticket.workerId != null
      ? (runtime?.registry.get(detail.ticket.workerId)?.name ?? null)
      : null;
    // execution 仅在执行相关态（DISPATCHED/IN_PROGRESS）返回——终态单不携带（前端以 execution 判执行中）
    const activeExec = detail.ticket.status === 'DISPATCHED' || detail.ticket.status === 'IN_PROGRESS';
    const enterExec = [...detail.transitions].reverse().find((t) => t.toStatus === 'IN_PROGRESS');
    return {
      ...detail,
      workerName,
      execution: activeExec && enterExec ? { startedAt: enterExec.createdAt } : null,
    };
  });

  // PATCH /api/tickets/:id —— 编辑（仅 DRAFT）
  app.patch('/api/tickets/:id', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(patchBody, req.body);
    return service.updateTicket(id, body);
  });

  // POST /api/tickets/:id/spec —— 提交 spec（写快照 + 冻结转 SPEC_READY）
  app.post('/api/tickets/:id/spec', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(specBody, req.body);
    return service.submitSpec(id, body.specContent);
  });

  // POST /api/tickets/:id/transition —— 状态转移（人工通道；TASK 放行触发自动派发）
  app.post('/api/tickets/:id/transition', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(transitionBody, req.body);
    const updated = service.transition(id, body.to, {
      actor: 'user',
      note: body.note,
      workerId: body.workerId,
    });
    if (runtime?.autoDispatch && updated.type === 'TASK' && updated.status === 'DISPATCHED') {
      runtime.dispatcher.onDispatched(updated);
    }
    return updated;
  });

  // POST /api/tickets/:id/comments —— 留言（S1 固定 user/我）
  app.post('/api/tickets/:id/comments', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(commentBody, req.body);
    const comment = service.addComment(id, {
      authorType: 'user',
      authorName: '我',
      content: body.content,
    });
    return reply.code(201).send(comment);
  });

  // POST /api/tickets/:id/dependencies —— 加 blockedBy 依赖边
  app.post('/api/tickets/:id/dependencies', async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const body = parse(dependencyBody, req.body);
    service.addDependency(id, body.blockedByTicketId);
    return reply.code(201).send({ ok: true });
  });

  // DELETE /api/tickets/:id/dependencies/:blockedById —— 删依赖边（幂等）
  app.delete('/api/tickets/:id/dependencies/:blockedById', async (req, reply) => {
    const params = parse(dependencyParams, req.params);
    service.removeDependency(params.id, params.blockedById);
    return reply.code(204).send();
  });
}
