import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from './db/schema.js';
import { AppError, ERROR_STATUS } from './domain/errors.js';
import { TicketService } from './domain/ticket-service.js';
import { registerTicketRoutes } from './routes/tickets.js';

/**
 * 构建 Fastify 应用（测试经 fastify.inject 复用同一工厂）。
 * 错误统一包裹：领域 AppError → 对应状态码 + { error: { code, message, details? } }；
 * 框架 4xx（如 JSON 解析失败）→ 归一 VALIDATION/BAD_REQUEST；其余 → 500 INTERNAL。
 */
export function buildApp(db: BetterSQLite3Database<typeof schema>): FastifyInstance {
  const app = Fastify({ logger: false });
  // S1 本地单用户，放开跨域便于浏览器直连调试
  void app.register(cors);

  const service = new TicketService(db);
  registerTicketRoutes(app, service);

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

  return app;
}
