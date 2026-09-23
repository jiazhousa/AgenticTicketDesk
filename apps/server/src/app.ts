import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { WorkerRegistry } from '@atd/worker-core';
import type { AppConfig } from './config.js';
import { Dispatcher } from './dispatcher.js';
import { AppError, ERROR_STATUS } from './domain/errors.js';
import { TicketService } from './domain/ticket-service.js';
import type * as schema from './db/schema.js';
import { registerExecutionRoutes } from './routes/execution.js';
import { registerTicketRoutes } from './routes/tickets.js';
import { registerWorkerRoutes } from './routes/workers.js';
import { WorktreeManager } from './worktree.js';

/** 编排运行时（service/dispatcher/worktree/registry 由 buildServer 组装） */
export type AppRuntime = {
  service: TicketService;
  dispatcher: Dispatcher;
  registry: WorkerRegistry;
  config: AppConfig;
  worktree: WorktreeManager;
  autoDispatch: boolean;
};

/** buildServer 入参：测试可注入 autoDispatch/timeoutOverrideMs/前置校验降级 */
export type RuntimeOptions = {
  config: AppConfig;
  registry: WorkerRegistry;
  /** 缺省 true：放行后自动 spawn；测试上下文关闭以确定时序 */
  autoDispatch?: boolean;
  /** 测试注入：覆盖 profile timeoutMin 的超时毫秒数 */
  timeoutOverrideMs?: number;
  /** worktree 前置校验：real=真实 mkdir+git 探测（缺省）；skip=纯域测试跳过 */
  worktreeGuard?: 'real' | 'skip';
};

/**
 * 组装编排运行时并构建 Fastify 应用（测试经 fastify.inject 复用同一工厂）。
 * 错误统一包裹：领域 AppError → 对应状态码 + { error: { code, message, details? } }；
 * 框架 4xx（如 JSON 解析失败）→ 归一 VALIDATION/BAD_REQUEST；其余 → 500 INTERNAL。
 */
export function buildApp(db: BetterSQLite3Database<typeof schema>, runtime?: AppRuntime): FastifyInstance {
  const app = Fastify({ logger: false });
  // 本地单用户，放开跨域便于浏览器直连调试
  void app.register(cors);

  const service = runtime?.service ?? new TicketService(db);
  registerTicketRoutes(app, service, runtime);
  registerWorkerRoutes(app, runtime);
  registerExecutionRoutes(app, service, runtime);

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof AppError) {
      const body = { error: { code: err.code, message: err.message } as { code: string; message: string; details?: string[] } };
      if (err.details?.length) body.error.details = err.details;
      return reply.code(ERROR_STATUS[err.code]).send(body);
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 400 && status < 500) {
      const code = status === 400 ? 'VALIDATION' : 'BAD_REQUEST';
      return reply.code(status).send({ error: { code, message: err.message } });
    }
    app.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: '系统内部错误' } });
  });

  // 未匹配路由统一走错误信封
  app.setNotFoundHandler((_req, reply) => {
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
  });

  return app;
}

/**
 * 组装完整编排运行时（service 带放行三件套 guards + dispatcher + worktree 管理器）并构建应用。
 * 测试上下文与生产入口共用。
 */
export function buildServer(
  db: BetterSQLite3Database<typeof schema>,
  opts: RuntimeOptions,
): { app: FastifyInstance; runtime: AppRuntime; worktree: WorktreeManager } {
  const worktree = new WorktreeManager(opts.config.repoPath, opts.config.dataDir);
  const { registry } = opts;
  const service = new TicketService(db, {
    knownWorkerIds: () => registry.ids(),
    assertWorktreeReady: opts.worktreeGuard === 'skip' ? () => {} : () => worktree.assertReady(),
  });
  const autoDispatch = opts.autoDispatch ?? true;
  const dispatcher = new Dispatcher({
    db,
    service,
    registry,
    config: opts.config,
    worktree,
    autoDispatch,
    timeoutOverrideMs: opts.timeoutOverrideMs,
  });
  const runtime: AppRuntime = {
    service,
    dispatcher,
    registry,
    config: opts.config,
    worktree,
    autoDispatch,
  };
  return { app: buildApp(db, runtime), runtime, worktree };
}
