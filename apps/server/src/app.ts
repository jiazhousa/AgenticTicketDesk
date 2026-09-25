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
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { WorktreeManager } from './worktree.js';
import { WorkspaceRegistry } from './workspaces.js';

/** 编排运行时（service/dispatcher/worktree/registry/workspaces 由 buildServer 组装） */
export type AppRuntime = {
  service: TicketService;
  dispatcher: Dispatcher;
  registry: WorkerRegistry;
  config: AppConfig;
  worktree: WorktreeManager;
  workspaces: WorkspaceRegistry;
  autoDispatch: boolean;
};

/** buildServer 入参：测试可注入 autoDispatch/timeoutOverrideMs/前置校验降级/tick 时序 */
export type RuntimeOptions = {
  config: AppConfig;
  registry: WorkerRegistry;
  /** workspace 注册表（loadWorkspaces 产物；测试 fixture 与生产统一走该入口——D2） */
  workspaces: WorkspaceRegistry;
  /** 缺省 true：放行后自动 spawn；测试上下文关闭以确定时序 */
  autoDispatch?: boolean;
  /** 测试注入：覆盖 profile timeoutMin 的超时毫秒数 */
  timeoutOverrideMs?: number;
  /** worktree 前置校验：real=真实 mkdir+git 探测（缺省）；skip=纯域测试跳过 */
  worktreeGuard?: 'real' | 'skip';
  /** RETRY_WAIT 扫描周期（ms）透传 DispatcherDeps（缺省 5000）；测试注入缩短 */
  tickIntervalMs?: number;
  /** 时钟注入透传 DispatcherDeps（缺省 Date.now）；退避断言构造用 */
  now?: () => number;
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

  // 无 runtime 的退化分支（纯路由信封测试）：空注册表——建单即 WORKSPACE_UNKNOWN，尽早暴露误用
  const service = runtime?.service ?? new TicketService(db, new WorkspaceRegistry());
  registerTicketRoutes(app, service, runtime);
  registerWorkerRoutes(app, runtime);
  registerExecutionRoutes(app, service, runtime);
  registerWorkspaceRoutes(app, runtime);

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
 * 组装完整编排运行时（service 带放行四件套 guards + dispatcher + worktree 管理器）并构建应用。
 * 装配顺序：workspaces（由调用方 loadWorkspaces 产物经 opts 传入，先于一切）→ worktree → dispatcher → routes。
 * 测试上下文与生产入口共用。
 */
export function buildServer(
  db: BetterSQLite3Database<typeof schema>,
  opts: RuntimeOptions,
): { app: FastifyInstance; runtime: AppRuntime; worktree: WorktreeManager } {
  const { registry, workspaces } = opts;
  const worktree = new WorktreeManager(opts.config.dataDir);
  const service = new TicketService(
    db,
    workspaces,
    {
      knownWorkerIds: () => registry.ids(),
      assertWorktreeReady:
        opts.worktreeGuard === 'skip' ? () => {} : (id: number, repoPath: string) => worktree.assertReady(repoPath),
    },
    { maxConcurrentPerRepo: opts.config.maxConcurrentPerRepo },
  );
  const autoDispatch = opts.autoDispatch ?? true;
  const dispatcher = new Dispatcher({
    db,
    service,
    registry,
    config: opts.config,
    worktree,
    workspaces,
    autoDispatch,
    timeoutOverrideMs: opts.timeoutOverrideMs,
    tickIntervalMs: opts.tickIntervalMs,
    now: opts.now,
  });
  // user 取消边释放占用后的队列重校验回调（service 先于 dispatcher 构造，setter 事后注入；
  // 箭头包裹防 this 丢失；定向传触发票 id，同 workspace+repoRef 排队单重校验）
  service.onInflightReleased = (ticketId) => dispatcher.releaseAndRecheck(ticketId);
  // RETRY_WAIT 扫描随 Dispatcher 启动；清理挂 Fastify onClose（AppRuntime 无生命周期概念）
  dispatcher.startTick();
  const runtime: AppRuntime = {
    service,
    dispatcher,
    registry,
    config: opts.config,
    worktree,
    workspaces,
    autoDispatch,
  };
  const app = buildApp(db, runtime);
  app.addHook('onClose', async () => {
    dispatcher.stopTick();
  });
  return { app, runtime, worktree };
}
