import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FIXTURE_WORKERS_DIR = path.join(FIXTURES_DIR, 'workers');

/** 每用例独立内存库 + 服务 + app 三合一上下文 */
export type TestContext = {
  db: BetterSQLite3Database<typeof schema>;
  service: TicketService;
  app: FastifyInstance;
  registry: WorkerRegistry;
  dispatcher: Dispatcher;
  worktree: WorktreeManager;
  config: AppConfig;
};

/**
 * 默认测试上下文：fixture 注册表（id=fake）+ worktree 前置校验跳过 + autoDispatch 关闭
 * （放行只走校验不触发 spawn，时序确定）。需真实执行/真实仓库的用例用 createRealContext。
 */
export function createTestContext(): TestContext {
  const db = createDatabase(':memory:');
  const registry = loadRegistry(FIXTURE_WORKERS_DIR);
  const config: AppConfig = {
    repoPath: path.join(tmpdir(), 'atd-dummy-repo'), // worktreeGuard=skip 时不触达
    dataDir: mkdtempSync(path.join(tmpdir(), 'atdt-')),
    defaultTimeoutMin: 5,
    retryOnReportMiss: 1,
  };
  const { app, runtime, worktree } = buildServer(db, {
    config,
    registry,
    autoDispatch: false,
    worktreeGuard: 'skip',
  });
  return {
    db,
    app,
    service: runtime.service,
    registry,
    dispatcher: runtime.dispatcher,
    worktree,
    config: runtime.config,
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
 */
export function createRealContext(
  opts: {
    profiles?: Array<{ id: string; command: string; timeoutMin?: number }>;
    autoDispatch?: boolean;
    timeoutOverrideMs?: number;
    retryOnReportMiss?: number;
    repoPath?: string;
    dataDir?: string;
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
  const { app, runtime, worktree } = buildServer(db, {
    config: {
      repoPath,
      dataDir,
      defaultTimeoutMin: 5,
      retryOnReportMiss: opts.retryOnReportMiss ?? 1,
    },
    registry,
    autoDispatch: opts.autoDispatch ?? false,
    timeoutOverrideMs: opts.timeoutOverrideMs,
  });
  return {
    db,
    app,
    service: runtime.service,
    registry,
    dispatcher: runtime.dispatcher,
    worktree,
    config: runtime.config,
  };
}

/** 捕获服务层同步抛出的 AppError（未抛出则失败） */
export function captureError(fn: () => unknown): { code: string; message: string; details?: string[] } {
  try {
    fn();
  } catch (err) {
    const e = err as { code?: string; message: string; details?: string[] };
    if (!e.code) throw new Error(`预期 AppError，实际抛出：${String(err)}`);
    return { code: e.code, message: e.message, details: e.details };
  }
  throw new Error('预期抛出 AppError，但未抛出');
}
