import type { FastifyInstance } from 'fastify';
import { isInteractiveServeCompatible } from '@atd/worker-core';
import type { AppRuntime } from '../app.js';

/** GET /api/workers —— 注册表列表（放行弹层选 worker 数据源） */
export function registerWorkerRoutes(app: FastifyInstance, runtime?: AppRuntime): void {
  app.get('/api/workers', async () => {
    return (runtime?.registry.list() ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      capabilities: p.capabilities,
      /** 聊天可用性（仅对声明 interactive 的 worker 有意义）：serve 形态可承载才可用；未声明 interactive 的 worker 不适用（缺省 undefined） */
      available: p.capabilities.includes('interactive') ? isInteractiveServeCompatible(p) : undefined,
    }));
  });
}
