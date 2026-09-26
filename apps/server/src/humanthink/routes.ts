import { and, asc, desc, eq, isNotNull, isNull, like, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isInteractiveServeCompatible } from '@atd/worker-core';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AppRuntime } from '../app.js';
import { AppError } from '../domain/errors.js';
import { humanthinkEvents, humanthinkSessions } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import type { EventHub, HumanThinkEvent } from './events.js';
import { confirmPlan, planPayloadSchema, validatePlan } from './plan.js';

/**
 * humanthink 路由：11 端点（S2b1 会话族 9 + S2b2 计划 validate/confirm 2）。
 * degraded（serve 非 ready/无可用 worker）全端点 503 WORKER_UNAVAILABLE——工单功能不受影响；
 * 已删会话三分语义：列表排除；详情可查（含 deletedAt+内嵌历史）；操作端点（prompt/interrupt/
 * delete/reply/SSE/plan）一律 422 SESSION_TERMINATED。
 */

/** 会话视图（API 形态；createdAt/deletedAt 为 epoch ms） */
export type SessionInfo = {
  id: string;
  workerId: string;
  workspaceId: string;
  directory: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  deletedAt: number | null;
};

/** 详情内嵌历史事件项（镜像回放，规则 5「历史可查」唯一读通道） */
export type SessionEventInfo = {
  seq: number;
  serveSeq: number | null;
  type: string;
  event: HumanThinkEvent;
  createdAt: number;
};

/** 待审条目（本地镜像 pending 行——审批历史与 UI 数据同源） */
export type PermissionRequestInfo = { requestID: string; action: string; resources: string[] };

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

const createBody = z.object({
  workerId: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
});

const promptBody = z.object({ text: z.string().min(1, '消息不能为空').max(100_000) });

const replyBody = z.object({
  decision: z.enum(['once', 'reject']),
  message: z.string().max(10_000).optional(),
});

const emptyAsUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

const listQuery = z.object({
  workspaceId: emptyAsUndefined(z.string()).optional(),
  q: emptyAsUndefined(z.string()).optional(),
  /** 已删会话枚举（「已删除」查看入口）：1/true=仅已删；缺省/0=仅活跃（三分语义） */
  deleted: emptyAsUndefined(z.enum(['1', '0', 'true', 'false'])).optional(),
});

const eventsQuery = z.object({ after: z.coerce.number().int().min(0).default(0) });

/** 会话行 → API 视图 */
function toInfo(row: typeof humanthinkSessions.$inferSelect): SessionInfo {
  return {
    id: row.id,
    workerId: row.workerId,
    workspaceId: row.workspaceId,
    directory: row.directory,
    title: row.title,
    createdAt: row.createdAt,
    lastActiveAt: row.lastActiveAt,
    deletedAt: row.deletedAt,
  };
}

export function registerHumanThinkRoutes(
  app: FastifyInstance,
  db: BetterSQLite3Database<typeof schema>,
  runtime: AppRuntime,
): void {
  const ht = runtime.humanthink;
  if (ht == null) return;

  /** degraded 门卫：serve 非 ready 或无可用 interactive worker → 全端点 503 */
  const assertAvailable = (): void => {
    if (ht.serve != null ? ht.serve.currentState !== 'ready' : true) {
      throw new AppError('WORKER_UNAVAILABLE', ht.serve != null ? 'humanthink 服务不可用（serve 未就绪或已降级）' : '未注册提供聊天能力的 worker（interactive + opencode serve 形态）');
    }
  };

  /** 会话定位：未知 404；操作端点另做已删检查（三分语义） */
  const loadSession = (id: string): typeof humanthinkSessions.$inferSelect => {
    const row = db.select().from(humanthinkSessions).where(eq(humanthinkSessions.id, id)).get();
    if (row == null) throw new AppError('SESSION_NOT_FOUND', '会话不存在');
    return row;
  };

  const assertActive = (row: typeof humanthinkSessions.$inferSelect): void => {
    if (row.deletedAt != null) throw new AppError('SESSION_TERMINATED', '会话已删除，历史仍可查看但不可再操作');
  };

  /** 会话归属 workspace 解析（repoRef 取值域与建单归属之源；yaml 漂移致缺失时 422） */
  const loadSessionWorkspace = (row: typeof humanthinkSessions.$inferSelect) => {
    const ws = runtime.workspaces.get(row.workspaceId);
    if (ws == null) {
      throw new AppError('WORKSPACE_UNKNOWN', `会话所属 workspace 已不可用：${row.workspaceId}（workspaces 声明已变更）`);
    }
    return ws;
  };

  app.post('/api/humanthink/sessions', async (req) => {
    assertAvailable();
    const body = parse(createBody, req.body);
    const profile = runtime.registry.get(body.workerId);
    if (profile == null) throw new AppError('WORKER_UNKNOWN', `worker 未注册：${body.workerId}`);
    if (!isInteractiveServeCompatible(profile)) {
      throw new AppError('WORKER_UNKNOWN', `worker 不提供聊天能力（需 interactive 能力且 serve 为 opencode 形态）：${body.workerId}`, ['聊天框 worker 下拉不列出该 worker（MVP 单 serve 边界）']);
    }
    const ws = runtime.workspaces.get(body.workspaceId);
    if (ws == null) throw new AppError('WORKSPACE_UNKNOWN', `workspace 未声明：${body.workspaceId}`);
    const directory = runtime.workspaces.resolveRepoPath(body.workspaceId, null);
    if (directory == null) throw new AppError('WORKSPACE_UNKNOWN', `workspace 主仓不可解析：${body.workspaceId}`);
    const created = await ht.facade.createSession(`atd-ht-${body.workspaceId}`, directory, body.title);
    const now = Date.now();
    const info: SessionInfo = {
      id: created.id,
      workerId: body.workerId,
      workspaceId: body.workspaceId,
      directory,
      title: body.title ?? `会话 ${new Date(now).toLocaleString('zh-CN')}`,
      createdAt: now,
      lastActiveAt: now,
      deletedAt: null,
    };
    db.insert(humanthinkSessions).values({
      id: info.id,
      workerId: info.workerId,
      workspaceId: info.workspaceId,
      directory: info.directory,
      title: info.title,
      createdAt: info.createdAt,
      lastActiveAt: info.lastActiveAt,
      deletedAt: null,
    }).run();
    return { session: info };
  });

  app.get('/api/humanthink/sessions', async (req) => {
    assertAvailable();
    const q = parse(listQuery, req.query);
    const showDeleted = q.deleted === '1' || q.deleted === 'true';
    const deletedFilter = showDeleted
      ? isNotNull(humanthinkSessions.deletedAt)
      : isNull(humanthinkSessions.deletedAt);
    const rows = db
      .select()
      .from(humanthinkSessions)
      .where(
        q.workspaceId != null
          ? and(deletedFilter, eq(humanthinkSessions.workspaceId, q.workspaceId))
          : deletedFilter,
      )
      .orderBy(desc(humanthinkSessions.lastActiveAt))
      .all();
    let items = rows.map(toInfo);
    if (q.q != null) {
      const kw = `%${q.q}%`;
      const hitSessionIds = new Set(
        db
          .selectDistinct({ sessionId: humanthinkEvents.sessionId })
          .from(humanthinkEvents)
          .where(like(humanthinkEvents.payload, kw))
          .all()
          .map((r) => r.sessionId),
      );
      items = items.filter((s) => s.title.includes(q.q!) || hitSessionIds.has(s.id));
    }
    return { items };
  });

  // 详情：唯一包含已删会话的读通道（内嵌只读历史）
  app.get('/api/humanthink/sessions/:id', async (req) => {
    assertAvailable();
    const row = loadSession((req.params as { id: string }).id);
    const events = db
      .select()
      .from(humanthinkEvents)
      .where(eq(humanthinkEvents.sessionId, row.id))
      .orderBy(asc(humanthinkEvents.seq))
      .all()
      .map<SessionEventInfo>((e) => ({
        seq: e.seq,
        serveSeq: e.serveSeq,
        type: e.type,
        event: JSON.parse(e.payload) as HumanThinkEvent,
        createdAt: e.createdAt,
      }));
    return { session: toInfo(row), events };
  });

  // SSE：镜像回放（seq>after）+ live 合流；delta 帧不重放（断线以最后 durable seq 为 after）
  app.get('/api/humanthink/sessions/:id/events', async (req, reply) => {
    assertAvailable();
    const id = (req.params as { id: string }).id;
    const { after } = parse(eventsQuery, req.query);
    const row = loadSession(id);
    assertActive(row);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const write = (frame: { seq?: number; event: HumanThinkEvent }): void => {
      raw.write(`data: ${JSON.stringify(frame)}\n\n`);
    };
    // 连接即冲刷——Node 在首字节前不发送响应头，回放为空（after=最新）时浏览器 EventSource 将滞留 CONNECTING 直到 15s 心跳
    raw.write(': connected\n\n');
    const detach = ht.events.attach(id, after, write);
    const hb = setInterval(() => raw.write(': hb\n\n'), 15_000);
    hb.unref?.();
    raw.on('close', () => {
      clearInterval(hb);
      detach();
    });
  });

  app.post('/api/humanthink/sessions/:id/prompt', async (req) => {
    assertAvailable();
    const id = (req.params as { id: string }).id;
    const body = parse(promptBody, req.body);
    const row = loadSession(id);
    assertActive(row);
    const res = await ht.facade.prompt(id, body.text);
    // 用户消息即时落历史行（messageId 幂等；对账时自动去重）——「不丢话」双保险
    ht.events.insertUserMessage(id, res.messageId, body.text);
    return { admitted: true, messageId: res.messageId };
  });

  app.post('/api/humanthink/sessions/:id/interrupt', async (req) => {
    assertAvailable();
    const id = (req.params as { id: string }).id;
    const row = loadSession(id);
    assertActive(row);
    await ht.facade.interrupt(id);
    return { ok: true };
  });

  app.delete('/api/humanthink/sessions/:id', async (req) => {
    assertAvailable();
    const id = (req.params as { id: string }).id;
    const row = loadSession(id);
    assertActive(row);
    await ht.facade.deleteSession(id);
    db
      .update(humanthinkSessions)
      .set({ deletedAt: Date.now() })
      .where(eq(humanthinkSessions.id, id))
      .run();
    return { ok: true };
  });

  app.get('/api/humanthink/sessions/:id/permission/requests', async (req) => {
    assertAvailable();
    const id = (req.params as { id: string }).id;
    const row = loadSession(id);
    assertActive(row);
    const rows = db
      .select({ payload: humanthinkEvents.payload })
      .from(humanthinkEvents)
      .where(
        and(
          eq(humanthinkEvents.sessionId, id),
          eq(humanthinkEvents.type, 'permission_request'),
          sql`json_extract(${humanthinkEvents.payload}, '$.status') = 'pending'`,
        ),
      )
      .orderBy(asc(humanthinkEvents.seq))
      .all();
    const items = rows.map((r) => {
      const p = JSON.parse(r.payload) as { requestID: string; action: string; resources: string[] };
      return { requestID: p.requestID, action: p.action, resources: p.resources } satisfies PermissionRequestInfo;
    });
    return { items };
  });

  app.post('/api/humanthink/sessions/:id/permission/:requestID/reply', async (req) => {
    assertAvailable();
    const { id, requestID } = req.params as { id: string; requestID: string };
    const body = parse(replyBody, req.body);
    const row = loadSession(id);
    assertActive(row);
    // always 档在 zod 枚举即被拒（VALIDATION 400）——不透传防静默授权扩散
    await ht.facade.replyPermission(id, requestID, body.decision, body.message);
    ht.events.recordReply(id, requestID, body.decision);
    return { ok: true };
  });

  // 计划预检：200 恒定（body 形态错走 400 信封；空 issues=可确认）
  app.post('/api/humanthink/sessions/:id/plan/validate', async (req) => {
    assertAvailable();
    const id = (req.params as { id: string }).id;
    const body = parse(planPayloadSchema, req.body);
    const row = loadSession(id);
    assertActive(row);
    const ws = loadSessionWorkspace(row);
    return { issues: validatePlan(body, { ws, registry: runtime.registry }) };
  });

  // 计划确认建单：200 双态——通过 {ok:true, story, tasks}；校验失败 {ok:false, issues} 且零建单
  // （不走 AppError 信封，对象形态问题清单直达计划卡标红；建单事务失败仍走错误信封）
  app.post('/api/humanthink/sessions/:id/plan/confirm', async (req) => {
    assertAvailable();
    const id = (req.params as { id: string }).id;
    const body = parse(planPayloadSchema, req.body);
    const row = loadSession(id);
    assertActive(row);
    const ws = loadSessionWorkspace(row);
    return confirmPlan(body, {
      db,
      service: runtime.service,
      ws,
      registry: runtime.registry,
      // 事务提交后同步触发链上无依赖根任务放行（闸门满落 S3 排队非失败）
      onCommitted: (storyId) => runtime.dispatcher.releaseChainReady(storyId),
    });
  });
}
