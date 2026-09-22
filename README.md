# AgenticTicketDesk

人机协作工单系统：人提单 → Agent 解单 → 卡点反向派给人——S1（核心域骨架：工单 CRUD / 状态机 / 父子 DAG / 依赖 / 留言 / 最小看板）。

## 结构

```
apps/server   # Fastify 5 + Drizzle + better-sqlite3（WAL），REST API（端口 3001）
apps/web      # Vite + React 18 + antd 5 看板（端口 5173，/api 代理到 3001）
```

## 开发启动

前置：Node ≥ 22.19，pnpm。

```bash
pnpm install          # 安装全部 workspace 依赖
pnpm dev              # 并行启动 server(3001) + web(5173)
```

- 列表页：http://localhost:5173/tickets
- 详情页：列表行点击进入；状态操作/spec 冻结/依赖管理/留言/时间线均在详情页
- 开发库文件 `apps/server/data/atd.db`（gitignore，首次启动自动建表）

## 常用命令

```bash
pnpm -F @atd/server test   # 服务层 + API 层测试（vitest，内存库）
pnpm -F @atd/web build     # 前端类型检查 + 构建
```
