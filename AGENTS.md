# AgenticTicketDesk（ATD）项目记忆

> 供人与 worker agent 共读的项目说明书。worker 被派发本仓任务时，以本文档为首要上下文。

## 一、定位与架构

人机协作工单系统：人提单 → Agent（worker）解单 → 卡点反向派给人。ATD 是 agent 层之上的**面板**——不 own 任何 agent，用户 agent 以声明式 yaml profile 注册为 worker；OpenCode 预置首实现，pi 预留。

- 单用户自用起步（无认证）；pnpm monorepo + Node 22 + TypeScript
- 代码变更验证前置：`.specpipe/fence.sh`（四包 tsc + 三包单测 + web build），任何改动合入前必须全绿

```
apps/server          # Fastify + Drizzle/better-sqlite3：工单域 + 编排（dispatcher）
apps/web             # React + Vite + antd：工作台/仪表盘/详情/日志页
packages/worker-core # worker 注册协议（profile zod + 校验：token/凭据扫描/schema）
packages/worker-opencode # opencode 适配（事件流解析/进程管理）
config.yaml          # dataDir（~/.local/share/atd）/超时/重试（repoPath 已不参与装配）
workspaces/atd.yaml  # workspace 声明式接入（ATD 自吃兼模板；目录缺失/非法声明=启动失败）
workers/opencode.yaml # worker profile 声明（spawn-cli 协议）
```

## 二、核心域概念速查

### 工单类型
- `STORY`：聚合容器，子单全落定（DONE/FAILED/CANCELLED）才可关单
- `TASK`：唯一可放行执行的类型；spec 快照（specContent）派发时固化
- 卡点（内联语义）：**无独立卡点单**——worker 报告 blocked 或报告缺失重试耗尽时，原单转 BLOCKED(pending:l3) 且 `blockReason` 字段内联卡点上下文（+system 留言全文）；裁决即原单操作 `POST /api/tickets/:id/resolve`（continue 原 worktree 续跑/reassign 换 worker/abort FAILED），转出 BLOCKED 自动清空 blockReason

### Workspace 多项目（apps/server/src/workspaces.ts）
- workspace=项目群容器（声明式 yaml，ATD 即普通一员）；**worker×workspace×repoRef=Task 三元组**定位一次执行
- repos：role=primary（主仓，建单缺省目标）| readable（可指定目标）；repoRef 建单后**不可变**（重开/改派沿用）
- 建单缺省 workspaceId=atd、repoRef=主仓（落库实际值）；父子/依赖边限同 workspace（CROSS_WORKSPACE 拒绝）
- 四错误码：WORKSPACE_UNKNOWN / REPO_REF_INVALID / REPO_REF_DRIFTED / CROSS_WORKSPACE

### 状态机（apps/server/src/domain/status.ts）
```
DRAFT → SPEC_READY → DISPATCHED → IN_PROGRESS → DONE | BLOCKED | FAILED
                      ↑                        ↓
终态(DONE/FAILED/CANCELLED) → DISPATCHED（重开：留言即指令，原 worktree round+1 续跑）
BLOCKED → IN_PROGRESS | DISPATCHED | FAILED | CANCELLED
DRAFT/SPEC_READY/DISPATCHED/BLOCKED → CANCELLED（user 边）
```
- 边表 `TRANSITIONS` + `isUserEdge`（type 分流）双定义，改动必须同步两侧
- TASK 放行四件套前置：workerId 必填（重开未指定则沿用原绑定）→ ∈Registry → worktree 可建 → repoRef 复校（user 通道漂移 422 REPO_REF_DRIFTED；system 自动放行链不复校，spawn 解析失败走 preSpawnFail→CANCELLED）
- 建单支持 `workerId` 预绑定（编排链拆单语义，自动放行前提；校验 ∈Registry）

### 依赖与编排链自动流转
- `ticket_dependencies`（blockedBy DAG）：环检测在 addDependency
- **自动放行**：单 DONE 后，下游「有 parent + SPEC_READY + 预绑定 worker + 其余依赖全 DONE」→ system 自动 DISPATCHED 并执行；独立单（无 parent）不自动，保持人工
- L2 重试：报告缺失/schema 错重试 1 次（round+1）；崩溃/超时直接 FAILED 不重试

### Worker spawn（packages/worker-opencode + apps/server/src/dispatcher.ts）
- worktree：`{dataDir}/worktrees/{repoName}-{workspaceId}-t{id}`（按工单 workspace+repoRef 解析目标仓）、分支 `atd/{workspaceId}-t{id}`（单实例内单号全局唯一；多 ATD 实例共管同仓不在当前定位内）
- 解单 cwd=目标仓 worktree，**目标仓自身的 AGENTS.md 随 checkout 被 opencode 天然加载**（跨仓 Story 的 Task 链各仓独立取知识）；API：`GET /api/workspaces(/:id)`、列表 `?workspaceId=`、建单 `workspaceId/repoRef`
- prompt 落 `{dataDir}/prompts/t{id}.r{round}.md`；round>1 注入轮次上下文（前轮报告 + 用户留言）
- 统一日志 `{dataDir}/logs/t{id}.r{round}.*.jsonl`；worker 产出 `atd-report.json`（done/blocked + summary + commits）
- commits 以 git 实测为准（基线 diff），报告值仅交叉校验

## 三、worker-opencode 六个实证坑（改 spawn 链路必读）

1. **repoRoot 相对定位层级数错**——worktree 目录嵌套深度与主仓不同，路径拼接要实测验证
2. **{{prompt}} 必须注入全文单参数**——文件路径形态 opencode 打 usage 报错
3. **本机 opencode run 无 --dir flag**（文档与版本漂移）——去 --dir，且必须加 `--standalone`（否则连共享 server，会话落错目录语境、commit 写错仓）
4. **权限 catch-all 必须 allow 不是 ask**——无人值守 ask=auto-reject 全拒；deny 后置覆盖（last-match-wins）；OPENCODE_CONFIG_CONTENT 内联注入生效
5. **opencode 从 worktree 的 .git gitfile 解析主仓当项目根**——shell workdir 错位、commit 落主仓分支；根治=prompt 头部工作目录强约束（buildPrompt 已内置）
6. **spawn pid 空检查必须在转 IN_PROGRESS 之前**（pre-spawn 失败 CANCELLED 保留可重派语义）

## 四、代码风格与约定

- 注释**终态化**：只陈述事实与原因，不带历史演进（无"旧口径/替代/rev2"）；新注释中文
- API 入参校验统一 zod（routes 层 `parse()` 包装，AppError.VALIDATION）
- 测试：vitest；dispatcher 真跑用例走 `createRealContext`（HTTP inject 触发 autoDispatch，service 层直调不触发 spawn）
- DB：SQLite 单文件（`apps/server/data/atd.db`，已 gitignore）；schema 变更走 drizzle migration
- 前端：antd 6 + 轮询（visibility 感知）；组件命名 PascalCase；api 契约手抄 types.ts 需与 server zod 同步

## 五、验证命令

```bash
pnpm -F @atd/server test            # 单包单测（改后端先跑这个）
pnpm -F @atd/web build              # 前端 tsc + 构建
bash .specpipe/fence.sh             # 全量门禁（合入前必跑）
```

## 六、升级纪律（自举场景：用 ATD 开发 ATD）

运行实例与 worker 产出物理隔离（worktree 分支），部署=显式重启。重启前三步：
1. fence 全绿才合 main
2. 重启前备份 DB：`cp apps/server/data/atd.db apps/server/data/atd.db.bak`
3. 起不来就 `git revert` 回上一可启动版本；涉 migration 的大改动先双实例冒烟（新代码+DB 副本起第二端口验证）
