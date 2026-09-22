import { buildApp } from '../src/app.js';
import { createDatabase } from '../src/db/client.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../src/db/schema.js';
import { TicketService } from '../src/domain/ticket-service.js';

/** 每用例独立内存库（同一套 migration 初始化，测试库 :memory:）+ 服务 + app 三合一上下文 */
export function createTestContext(): {
  db: BetterSQLite3Database<typeof schema>;
  service: TicketService;
  app: ReturnType<typeof buildApp>;
} {
  const db = createDatabase(':memory:');
  const service = new TicketService(db);
  const app = buildApp(db);
  return { db, service, app };
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
