import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppRuntime } from '../app.js';
import { AppError } from '../domain/errors.js';
import type { TicketService } from '../domain/ticket-service.js';

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

/** query 空字符串视为未传 */
const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const idParams = z.object({ id: z.coerce.number().int().positive() });

const logsQuery = z.object({
  round: emptyAsUndefined(z.coerce.number().int().min(0)).optional(),
  tail: emptyAsUndefined(z.coerce.number().int().min(1)).optional(),
});

const worktreeQuery = z.object({
  keepBranch: emptyAsUndefined(z.enum(['true', 'false'])).optional(),
});

const reopenBody = z.object({
  message: z.string().min(1),
  workerId: z.string().optional(),
});

const resolveBody = z.object({
  resolution: z.enum(['continue', 'reassign', 'abort']),
  note: z.string().optional(),
  reassignWorkerId: z.string().min(1).optional(),
});

/** 日志 tail 缺省 50、上限 500 */
const DEFAULT_TAIL = 50;
const MAX_TAIL = 500;

/** 执行域路由：事件流日志 / worktree 回收 / BLOCKER 裁决 */
export function registerExecutionRoutes(
  app: FastifyInstance,
  service: TicketService,
  runtime?: AppRuntime,
): void {
  // GET /api/tickets/:id/logs?round=&tail= —— 某轮统一事件流尾部（round 缺省=当前轮）
  app.get('/api/tickets/:id/logs', async (req) => {
    const { id } = parse(idParams, req.params);
    const q = parse(logsQuery, req.query);
    const ticket = service.getTicket(id);
    const round = q.round ?? ticket.round;
    const tail = Math.min(q.tail ?? DEFAULT_TAIL, MAX_TAIL);
    let events: unknown[] = [];
    if (runtime) {
      const file = path.join(runtime.config.dataDir, 'logs', `t${id}.r${round}.events.jsonl`);
      if (existsSync(file)) {
        events = readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
      }
    }
    return { round, events: events.slice(-tail) };
  });

  // DELETE /api/tickets/:id/worktree?keepBranch= —— 回收（执行中/非终态拒收；默认保留分支）
  app.delete('/api/tickets/:id/worktree', async (req) => {
    const { id } = parse(idParams, req.params);
    const q = parse(worktreeQuery, req.query);
    const keepBranch = q.keepBranch !== 'false';
    if (!runtime) {
      throw new AppError('WORKTREE_ACTIVE', '编排运行时未配置，无法回收 worktree');
    }
    const ticket = service.getTicket(id);
    if (runtime.dispatcher.isRunning(id)) {
      throw new AppError('WORKTREE_ACTIVE', `工单 #${id} 正在执行，禁止回收 worktree`);
    }
    if (!['DONE', 'CANCELLED', 'FAILED'].includes(ticket.status)) {
      throw new AppError(
        'WORKTREE_ACTIVE',
        `工单 #${id} 当前为 ${ticket.status}（须终态方可回收；BLOCKED 存续期 worktree 保留供裁决复用）`,
      );
    }
    // 回收仓路径按工单挂载解析（yaml 已删该 repo 声明时反查不可得 → 422 给修复指引）
    const repoPath = runtime.workspaces.resolveRepoPath(ticket.workspaceId, ticket.repoRef);
    if (repoPath == null) {
      throw new AppError(
        'REPO_REF_DRIFTED',
        `repoRef 已失效：workspace=${ticket.workspaceId} repoRef=${ticket.repoRef ?? '(null)'}（workspaces yaml 声明已变更，无法定位回收目标仓）`,
        ['修正 workspaces/*.yaml 恢复该仓声明后重试回收', '或确认该 worktree 目录已无保留价值后手动清理'],
      );
    }
    runtime.worktree.reclaim(ticket.workspaceId, id, repoPath, keepBranch);
    return { ok: true };
  });

  // POST /api/tickets/:id/resolve —— 卡点裁决（继续/改派/终止；卡点=原单 BLOCKED 状态）
  app.post('/api/tickets/:id/resolve', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(resolveBody, req.body);
    if (!runtime) {
      throw new AppError('RESOLUTION_INVALID', '编排运行时未配置，无法裁决');
    }
    return { ticket: runtime.dispatcher.resolveTicket(id, body) };
  });

  // POST /api/tickets/:id/reopen —— 终态重开（留言即本轮指令，原 worktree 续跑）
  app.post('/api/tickets/:id/reopen', async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(reopenBody, req.body);
    if (!runtime) {
      throw new AppError('RESOLUTION_INVALID', '编排运行时未配置，无法重开');
    }
    return runtime.dispatcher.reopen(id, body);
  });
}
