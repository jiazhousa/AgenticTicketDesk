import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, type WorkerRegistry } from '@atd/worker-core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { createDatabase } from '../src/db/client.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../src/db/schema.js';
import type { Dispatcher } from '../src/dispatcher.js';
import type { TicketService } from '../src/domain/ticket-service.js';
import type { WorktreeManager } from '../src/worktree.js';
import { loadWorkspaces, type WorkspaceRegistry } from '../src/workspaces.js';

export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIXTURE_WORKERS_DIR = path.join(FIXTURES_DIR, 'workers');

/** fixture workspace 声明形态（path 用绝对路径写入 yaml） */
export type WorkspaceRepoSpec = { id: string; path: string; role: 'primary' | 'readable' };
export type WorkspaceSpec = { id: string; name: string; repos: WorkspaceRepoSpec[] };

/** 写一个临时 fixture workspace yaml（与生产 workspaces/*.yaml 同格式） */
export function writeWorkspaceYaml(workspacesDir: string, spec: WorkspaceSpec): void {
  const lines = [`id: ${spec.id}`, `name: ${spec.name}`, 'repos:'];
  for (const r of spec.repos) {
    lines.push(`  - id: ${r.id}`, `    path: ${r.path}`, `    role: ${r.role}`);
  }
  writeFileSync(path.join(workspacesDir, `${spec.id}.yaml`), lines.join('\n') + '\n');
}

/** 构造临时 repoRoot（含 workspaces/ 目录）并加载（测试与生产统一走 loadWorkspaces 产物——D2） */
export function buildWorkspaceFixture(specs: WorkspaceSpec[]): { dir: string; registry: WorkspaceRegistry } {
  const root = mkdtempSync(path.join(tmpdir(), 'atdws-'));
  const dir = path.join(root, 'workspaces');
  mkdirSync(dir);
  for (const s of specs) writeWorkspaceYaml(dir, s);
  return { dir, registry: loadWorkspaces(root) };
}

/** 每用例独立内存库 + 服务 + app 三合一上下文 */
export type TestContext = {
  db: BetterSQLite3Database<typeof schema>;
  service: TicketService;
  app: FastifyInstance;
  registry: WorkerRegistry;
  dispatcher: Dispatcher;
  worktree: WorktreeManager;
  workspaces: WorkspaceRegistry;
  config: AppConfig;
  /** atd workspace 主仓绝对路径（worktree 路径断言与 git 操作基准） */
  repoPath: string;
};

/**
 * 默认测试上下文：fixture 注册表（id=fake）+ 单 atd workspace + worktree 前置校验跳过 + autoDispatch 关闭
 * （放行只走校验不触发 spawn，时序确定）。需真实执行/真实仓库的用例用 createRealContext。
 * workspaceSpecs 可注入多 workspace fixture（跨域/跨仓用例）。
 */
/**
 * 每用例独立内存库 + 服务 + app 三合一上下文。
 * S3 并发治理三键（maxConcurrentPerRepo/maxRetries/retryBackoffSec）与 dispatcher 时序
 * （tickIntervalMs/now）经 opts 注入透传，缺省与 config.yaml 缺省一致。
 */
export function createTestContext(
  opts: {
    workspaceSpecs?: WorkspaceSpec[];
    maxConcurrentPerRepo?: number;
    maxRetries?: number;
    retryBackoffSec?: number;
    tickIntervalMs?: number;
    now?: () => number;
    /** humanthink 旁路位（D8）：默认 false——既有测试零 serve 进程；专属测试传 true+seam */
    humanthink?: { enabled: true; fetchImpl?: typeof fetch; spawnImpl?: never; now?: () => number };
  } = {},
): TestContext {
  const db = createDatabase(':memory:');
  const registry = loadRegistry(FIXTURE_WORKERS_DIR);
  // worktreeGuard=skip 时不触达，仅满足 workspace 声明的 path 存在性校验
  const primaryRepo = mkdtempSync(path.join(tmpdir(), 'atdwr-'));
  const specs =
    opts.workspaceSpecs ??
    [{ id: 'atd', name: 'ATD', repos: [{ id: 'atd', path: primaryRepo, role: 'primary' as const }] }];
  const { registry: workspaces } = buildWorkspaceFixture(specs);
  const config: AppConfig = {
    dataDir: mkdtempSync(path.join(tmpdir(), 'atdt-')),
    defaultTimeoutMin: 5,
    maxConcurrentPerRepo: opts.maxConcurrentPerRepo ?? 2,
    maxRetries: opts.maxRetries ?? 3,
    retryBackoffSec: opts.retryBackoffSec ?? 60,
    humanthinkPort: 4900,
  };
  const { app, runtime, worktree } = buildServer(db, {
    config,
    registry,
    workspaces,
    autoDispatch: false,
    worktreeGuard: 'skip',
    tickIntervalMs: opts.tickIntervalMs,
    now: opts.now,
    humanthink: opts.humanthink ?? { enabled: false },
  });
  return {
    db,
    app,
    service: runtime.service,
    registry,
    dispatcher: runtime.dispatcher,
    worktree,
    workspaces: runtime.workspaces,
    config: runtime.config,
    repoPath: workspaces.resolveRepoPath('atd', null)!,
  };
}

/** 生成临时 git 仓（main 分支 + 初始提交 + 测试身份） */
export function makeTempRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'atdr-'));
  execFileSync('git', ['-C', dir, 'init', '-b', 'main']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'atd@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'atd-test']);
  writeFileSync(path.join(dir, 'README.md'), '# temp repo\n');
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-m', 'init']);
  return dir;
}

/** 写一个临时 fixture profile（命令为完整字符串，路径段保持短避免误触凭据扫描） */
export function writeFixtureProfile(
  workersDir: string,
  profile: { id: string; command: string; timeoutMin?: number },
): void {
  const yaml = [
    `id: ${profile.id}`,
    `name: ${profile.id}`,
    'protocol: spawn-cli',
    'capabilities: [task]',
    `command: ${profile.command}`,
    `timeoutMin: ${profile.timeoutMin ?? 5}`,
    '',
  ].join('\n');
  writeFileSync(path.join(workersDir, `${profile.id}.yaml`), yaml);
}

/**
 * 真实编排上下文：临时 git 仓 + 临时 dataDir + 自定义 profile 集 + worktree 前置校验真实生效。
 * autoDispatch 缺省关闭（校验型用例）；dispatcher.test 显式开启。
 * S3 并发治理三键与 dispatcher 时序同 createTestContext 透传；
 * profile command 可携带额外实参（双并行 fake worker 以命令行参数区分独立实例，见 fake-done-arg.mjs）。
 * extraRepos 为 atd workspace 追加 readable 仓（跨仓真跑用例：主仓=repoPath）。
 */
export function createRealContext(
  opts: {
    profiles?: Array<{ id: string; command: string; timeoutMin?: number }>;
    autoDispatch?: boolean;
    timeoutOverrideMs?: number;
    repoPath?: string;
    dataDir?: string;
    extraRepos?: Array<{ id: string; path: string }>;
    maxConcurrentPerRepo?: number;
    maxRetries?: number;
    retryBackoffSec?: number;
    tickIntervalMs?: number;
    now?: () => number;
    /** humanthink 旁路位（D8）：默认 false——真跑上下文零 serve 进程 */
    humanthink?: { enabled?: boolean; fetchImpl?: typeof fetch };
  } = {},
): TestContext {
  const db = createDatabase(':memory:');
  const repoPath = opts.repoPath ?? makeTempRepo();
  const dataDir = opts.dataDir ?? mkdtempSync(path.join(tmpdir(), 'atdd-'));
  const workersDir = mkdtempSync(path.join(tmpdir(), 'atdwp-'));
  for (const p of opts.profiles ?? [
    { id: 'fake', command: `node ${path.join(FIXTURES_DIR, 'fake-done.mjs')} {{worktree}} {{prompt}}` },
  ]) {
    writeFixtureProfile(workersDir, p);
  }
  const registry = loadRegistry(workersDir);
  const { registry: workspaces } = buildWorkspaceFixture([
    {
      id: 'atd',
      name: 'ATD',
      repos: [
        { id: 'atd', path: repoPath, role: 'primary' },
        ...(opts.extraRepos ?? []).map((r) => ({ id: r.id, path: r.path, role: 'readable' as const })),
      ],
    },
  ]);
  const { app, runtime, worktree } = buildServer(db, {
    config: {
      dataDir,
      defaultTimeoutMin: 5,
      maxConcurrentPerRepo: opts.maxConcurrentPerRepo ?? 2,
      maxRetries: opts.maxRetries ?? 3,
      retryBackoffSec: opts.retryBackoffSec ?? 60,
      humanthinkPort: 4900,
    },
    registry,
    workspaces,
    autoDispatch: opts.autoDispatch ?? false,
    timeoutOverrideMs: opts.timeoutOverrideMs,
    tickIntervalMs: opts.tickIntervalMs,
    now: opts.now,
    humanthink: opts.humanthink ?? { enabled: false },
  });
  return {
    db,
    app,
    service: runtime.service,
    registry,
    dispatcher: runtime.dispatcher,
    worktree,
    workspaces: runtime.workspaces,
    config: runtime.config,
    repoPath,
  };
}

/** 捕获服务层同步抛出的 AppError（未抛出则失败） */
export function captureError(fn: () => unknown): { code: string; message: string; details?: string[] } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message?: string; details?: string[] };
    if (!e.code) throw new Error(`预期 AppError，实际抛出：${String(err)}`);
    return { code: e.code, message: e.message!, details: e.details };
  }
  throw new Error('预期抛出 AppError，但未抛出');
}
