import type { FastifyInstance } from 'fastify';
import type { AppRuntime } from '../app.js';

/** GET /api/workers —— 注册表列表（放行弹层选 worker 数据源） */
export function registerWorkerRoutes(app: FastifyInstance, runtime?: AppRuntime): void {
  app.get('/api/workers', async () => {
    return (runtime?.registry.list() ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      capabilities: p.capabilities,
    }));
  });
}
