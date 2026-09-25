import path from 'node:path';
import { loadRegistry } from '@atd/worker-core';
import { buildServer } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { loadWorkspaces, type WorkspaceRegistry } from './workspaces.js';

// repo 根=apps/server/src 上三级；config.yaml 与 workers/ 均以 repo 根定位
const repoRoot = path.join(import.meta.dirname, '..', '..', '..');
const config = loadConfig(repoRoot);
const registry = loadRegistry(path.join(repoRoot, 'workers'));

// workspace 声明加载：非法即退出并打印文件名与原因（本地系统快速失败，不降级）
let workspaces: WorkspaceRegistry;
try {
  workspaces = loadWorkspaces(repoRoot);
} catch (err) {
  console.error('[atd-server] workspaces 加载失败：', (err as Error).message);
  process.exit(1);
}

// 开发库 apps/server/data/atd.db（gitignore）；启动时自动执行 migration
const db = createDatabase(path.join(import.meta.dirname, '..', 'data', 'atd.db'));
const { app, runtime, humanthinkStart } = buildServer(db, { config, registry, workspaces });

// 服务重启恢复（仍在监听前完成）：消亡进程对应的执行单收敛（IN_PROGRESS→FAILED / DISPATCHED→CANCELLED）+
// RETRY_WAIT 到期单立即恢复（计时器由 tick 重建）+ 排队单重校验一轮
runtime.dispatcher.recoverOnStartup();

// humanthink 启动时序（监听前）：config-gen → spawn serve → 订阅全局流；
// 失败转 degraded 不阻塞主服务（工单功能不受影响）。装配旁路位由 buildServer opts 决定（生产缺省启用）。
if (humanthinkStart != null) {
  await humanthinkStart();
}

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
