import path from 'node:path';
import { loadRegistry } from '@atd/worker-core';
import { buildServer } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';

// repo 根=apps/server/src 上三级；config.yaml 与 workers/ 均以 repo 根定位
const repoRoot = path.join(import.meta.dirname, '..', '..', '..');
const config = loadConfig(repoRoot);
const registry = loadRegistry(path.join(repoRoot, 'workers'));

// 开发库 apps/server/data/atd.db（gitignore）；启动时自动执行 migration
const db = createDatabase(path.join(import.meta.dirname, '..', 'data', 'atd.db'));
const { app, runtime } = buildServer(db, { config, registry });

// 服务重启恢复：消亡进程对应的执行单收敛（IN_PROGRESS→FAILED / DISPATCHED→CANCELLED）
runtime.dispatcher.recoverOnStartup();

const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: '127.0.0.1' })
  .then(() => {
    console.log(`[atd-server] listening on http://127.0.0.1:${port}`);
  })
  .catch((err) => {
    console.error('[atd-server] 启动失败', err);
    process.exit(1);
  });
