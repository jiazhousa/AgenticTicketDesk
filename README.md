# AgenticTicketDesk

人机协作工单系统：人提单 → Agent 解单 → 卡点反向派给人。

- **S1（核心域骨架）**：工单 CRUD / 状态机 / 父子 DAG / 依赖 / 留言 / 最小看板
- **S2a（执行闭环）**：TASK 放行选 worker → 独立 worktree 执行 → 事件流 / 报告 / commits 归集 →
  DONE / BLOCKED / FAILED；卡点升级 BLOCKER 单，人裁决（继续 / 改派 / 终止）后回流父单；worktree 回收

## 结构

```
apps/server          # Fastify 5 + Drizzle + better-sqlite3（WAL），REST API（端口 3001）
apps/web             # Vite + React 18 + antd 5 看板（端口 5173，/api 代理到 3001）
packages/worker-core # 统一事件流类型 + WorkerProfile schema + Registry
packages/worker-opencode # opencode spawn-CLI 协议（事件映射）
workers/             # worker profile（yaml，随仓版本化；预置 opencode）
config.yaml          # 项目配置（repoPath / dataDir / defaultTimeoutMin / retryOnReportMiss）
```

## 开发启动

前置：Node ≥ 22.19，pnpm。

```bash
pnpm install          # 安装全部 workspace 依赖
pnpm dev              # 并行启动 server(3001) + web(5173)
```

- 工作台：http://localhost:5173/workbench（默认首页——新建单 / 阻塞与待裁决 / 待处理快捷操作）
- 仪表盘：http://localhost:5173/dashboard（全局运行视图——进行中单 + 执行中 worker，点开直达日志页）
- 列表页：http://localhost:5173/tickets（全量兜底视图；状态/类型筛选；type=阻塞 = 卡点队列）
- 详情页：列表行点击进入；状态操作/spec 冻结/依赖管理/留言/时间线均在详情页；
  STORY 详情含「编排链泳道」（子单依赖分层 DAG，执行中橙呼吸、完成绿）
- TASK 执行链：放行（或建单预绑定 worker，依赖满足自动放行）→ 详情页「执行」卡看
  状态/worker/轮次/时长 → 「查看日志」进独立日志页（轮次选择 + 全量事件流 + 原始 JSON 切换）
  → 完成看「完成报告」卡（summary + commits）；卡点看「卡点处理」卡（裁决三选）；
  终态 TASK 可「重新开单」（留言即本轮指令，原 worktree 续跑）
- 开发库文件 `apps/server/data/atd.db`（gitignore，首次启动自动建表）

## 常用命令

```bash
pnpm -F @atd/server test          # 服务层 + API 层测试（vitest，内存库）
pnpm -F @atd/worker-core test     # profile 校验 / Registry 测试
pnpm -F @atd/worker-opencode test # 事件映射测试
pnpm -F @atd/web build            # 前端类型检查 + 构建
```
