import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

// migration 目录随源码定位（apps/server/drizzle），与 cwd 无关
const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/**
 * 建库并执行 migration。
 * 同步驱动铁则 2：连接建立即设置 WAL 与外键约束。
 * 开发库传文件路径（如 apps/server/data/atd.db），测试库传 ':memory:'——共用同一套 migration。
 */
export function createDatabase(url: string): BetterSQLite3Database<typeof schema> {
  if (url !== ':memory:') {
    mkdirSync(path.dirname(url), { recursive: true });
  }
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
