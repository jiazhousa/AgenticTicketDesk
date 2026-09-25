import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { DEFAULT_SERVE_COMMAND, isInteractiveServeCompatible } from '@atd/worker-core';
import type { WorkerRegistry } from '@atd/worker-core';
import type { AppConfig } from './config.js';
import { Dispatcher } from './dispatcher.js';
import { AppError, ERROR_STATUS } from './domain/errors.js';
import { TicketService } from './domain/ticket-service.js';
import type * as schema from './db/schema.js';
import { EventHub } from './humanthink/events.js';
import { buildServeConfig, extractUserGlobal, readUserGlobalRaw, writeServeConfig } from './humanthink/config-gen.js';
import { registerHumanThinkRoutes } from './humanthink/routes.js';
import { ServeManager, type ServeManagerDeps } from './humanthink/serve-manager.js';
import { SessionFacade } from './humanthink/session-facade.js';
import { registerExecutionRoutes } from './routes/execution.js';
import { registerTicketRoutes } from './routes/tickets.js';
import { registerWorkerRoutes } from './routes/workers.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { WorktreeManager } from './worktree.js';
import { WorkspaceRegistry } from './workspaces.js';

/** humanthink 运行时（装配旁路位关闭或未启用时 AppRuntime.humanthink 为 undefined） */
export type HumanThinkRuntime = {
  /** serve 托管（无可用 interactive worker 时为 null——路由层统一 503） */
  serve: ServeManager | null;
  facade: SessionFacade;
  events: EventHub;
  /** serve 命令来源 worker（MVP 单 serve；下拉可用性判定见 routes） */
  workerId: string | null;
};

/** 编排运行时（service/dispatcher/worktree/registry/workspaces 由 buildServer 组装） */
export type AppRuntime = {
  service: TicketService;
  dispatcher: Dispatcher;
  registry: WorkerRegistry;
  config: AppConfig;
  worktree: WorktreeManager;
  workspaces: WorkspaceRegistry;
  autoDispatch: boolean;
  humanthink?: HumanThinkRuntime;
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
  /**
   * humanthink 装配旁路位（D8）：缺省 true——生产启用；既有测试传 false 旁路
   * spawn/订阅（零 serve 进程）；humanthink 专属测试传 true + fetch/spawn seam 注入假 serve。
   */
  humanthink?: {
    enabled?: boolean;
    fetchImpl?: typeof fetch;
    spawnImpl?: ServeManagerDeps['spawnImpl'];
    now?: () => number;
    healthTimeoutMs?: number;
    restartBackoffMs?: number[];
  };
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
  // humanthink 路由仅在装配旁路位启用时挂载（enabled:false → 404，既有测试零感知）
  if (runtime?.humanthink != null) registerHumanThinkRoutes(app, db, runtime);

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
): { app: FastifyInstance; runtime: AppRuntime; worktree: WorktreeManager; humanthinkStart?: () => Promise<void> } {
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
  // humanthink 装配（D8 旁路位：缺省启用；测试传 false 旁路——零 serve 进程零订阅）。
  // 构造与启动分离：start() 由生产入口（index.ts）在监听前显式调用（config-gen→spawn→订阅）。
  let humanthinkStop: (() => void) | null = null;
  let humanthinkStart: (() => Promise<void>) | null = null;
  if (opts.humanthink?.enabled ?? true) {
    const assembled = assembleHumanThink(opts, db, runtime);
    runtime.humanthink = assembled.runtime;
    humanthinkStart = assembled.start;
    humanthinkStop = assembled.stop;
  }
  const app = buildApp(db, runtime);
  app.addHook('onClose', async () => {
    dispatcher.stopTick();
    humanthinkStop?.();
  });
  return { app, runtime, worktree, ...(humanthinkStart != null ? { humanthinkStart } : {}) };
}

/**
 * humanthink 三件套装配：无可用 interactive worker 时 serve=null（路由层统一 503，
 * 工单功能不受影响）；有则 ServeManager 携 serveCommand 模板（端口探测递补后渲染）。
 */
function assembleHumanThink(
  opts: RuntimeOptions,
  db: BetterSQLite3Database<typeof schema>,
  runtime: AppRuntime,
): { runtime: HumanThinkRuntime; start: () => Promise<void>; stop: () => void } {
  const { config } = opts;
  const profile = runtime.registry.list().find((p) => isInteractiveServeCompatible(p));
  const configDir = `${config.dataDir}/opencode-config`;
  const serve =
    profile != null
      ? new ServeManager({
          commandTemplate: (profile.interactive?.serveCommand ?? DEFAULT_SERVE_COMMAND).trim().split(/\s+/),
          configDir,
          cwd: config.dataDir,
          startPort: config.humanthinkPort,
          fetchImpl: opts.humanthink?.fetchImpl,
          spawnImpl: opts.humanthink?.spawnImpl,
          now: opts.humanthink?.now,
          healthTimeoutMs: opts.humanthink?.healthTimeoutMs,
          restartBackoffMs: opts.humanthink?.restartBackoffMs,
        })
      : null;
  const facade = new SessionFacade({
    serve: () => serve?.getHandle() ?? null,
    fetchImpl: opts.humanthink?.fetchImpl,
  });
  const events = new EventHub({
    db,
    serve: () => serve?.getHandle() ?? null,
    facade,
    fetchImpl: opts.humanthink?.fetchImpl,
    now: opts.humanthink?.now,
  });
  return {
    runtime: { serve, facade, events, workerId: profile?.id ?? null },
    start: async () => {
      // 启动时序（监听前）：config-gen（幂等重写）→ spawn（失败转 degraded 不阻塞）→ 订阅
      const cfg = buildServeConfig(
        extractUserGlobal(readUserGlobalRaw()),
        runtime.workspaces.list().map((ws) => ({ id: ws.id, repos: ws.repos.map((r) => ({ path: r.path, role: r.role })) })),
      );
      writeServeConfig(configDir, cfg);
      if (serve != null) await serve.start();
      events.start();
    },
    stop: () => {
      events.stop();
      serve?.stop();
    },
  };
}
