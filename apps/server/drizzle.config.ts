import { defineConfig } from 'drizzle-kit';

// migration 产出进仓（apps/server/drizzle/*.sql），server 启动与测试共用同一套
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
