import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发代理：前端 /api 请求转发到本地 server（apps/server，端口 3001）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
