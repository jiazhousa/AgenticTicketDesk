import path from 'node:path';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';

// 开发库 apps/server/data/atd.db（gitignore）；启动时自动执行 migration
const dataDir = path.join(import.meta.dirname, '..', 'data');
const db = createDatabase(path.join(dataDir, 'atd.db'));
const app = buildApp(db);

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
