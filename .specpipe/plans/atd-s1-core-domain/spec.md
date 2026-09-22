# Story Spec：S1 核心域骨架（工单 CRUD / 状态机 / DAG / 留言 + 最小看板）

- **topic**：atd-s1-core-domain
- **Epic**：agentic-ticket-desk（v4 已放行，§9 S1 行为本 spec 唯一范围来源）
- **状态**：v2（落实 r1 审查意见，SPEC_USER_AUDIT 待放行）
- **日期**：2026-09-22

---

## 1. 背景与定位

AgenticTicketDesk 的第一个 Story：交付工单核心域（无 worker 执行）。完成后，人可以手工建单、走完状态机全流程、维护依赖与留言——S2a 在此之上接 worker 解单。

技术底座按 Epic §7：pnpm monorepo / Node ≥22 / TS；apps/server（Fastify + Drizzle + SQLite WAL）；apps/web（React + Vite + antd）。

## 2. 范围

**做**：
1. monorepo 骨架（pnpm workspace：apps/server + apps/web；packages/* 空壳不建）
2. 工单实体：CRUD + 状态机（M1 六态）+ 父子 + blockedBy 依赖 + spec 快照冻结
3. 留言流 + 状态转移日志（时间线）
4. REST API（能力清单见 §4）
5. 最小看板：工单列表页 + 工单详情页（交互见 §5）
6. STORY 聚合规则（子单全 DONE → 父单可 DONE）

**不做**（后续 Story）：worker 执行与 worktree（S2a）；BLOCKED/FAILED 态与 BLOCKER 单（S2a/S3）；pending 标签（S2a/S3）；聊天框（S2b）；并行与文件集校验（S3）；审计 job（S4）；多仓注册（S1 单仓配置占位即可）。

## 3. 领域模型

### 3.1 工单（Ticket）

| 字段 | 语义 |
|---|---|
| id | 单号 |
| type | STORY / TASK / BLOCKER / DREAM（枚举全集一次建齐；S1 实际仅使用 STORY / TASK） |
| title / description | 标题与描述 |
| status | M1 六态：DRAFT / SPEC_READY / DISPATCHED / IN_PROGRESS / DONE / CANCELLED |
| parentId | 父单（STORY 的子 TASK 挂此）；STORY 无父 |
| specContent | spec 快照：DRAFT 期可编辑（与 title/description 同通道）；**冻结时点 = 转入 SPEC_READY**（此后不可改；后续变更走变更单，非本 Story） |
| workerId | 执行 worker 绑定（可空，S2a 消费；S1 建 dispatch 时允许空占位） |
| 时间戳 | createdAt / updatedAt |

### 3.2 状态机（M1 转移表，边集封闭）

```
DRAFT → SPEC_READY        （提交 spec，冻结快照）
SPEC_READY → DISPATCHED   （放行派发）
SPEC_READY → CANCELLED    （拒绝）
DISPATCHED → IN_PROGRESS  （开始执行）
DISPATCHED → CANCELLED    （撤回）
IN_PROGRESS → DONE        （完成关单）
```

- 转移表为显式白名单；非法转移返回 422 且状态不变
- 每次转移落 ticket_transitions（from/to/operator/note/时间）——时间线与后续 L1 留痕共用此基础设施
- **SPEC_READY 只能经 POST /spec 进入**（提交即冻结）；/transition 端点不接受 to=SPEC_READY，防绕开冻结逻辑
- STORY 聚合：子单全 DONE（CANCELLED 视为已收敛，不阻塞）→ 父单允许 DONE（人工确认关单）；存在未完成子单时父单 DONE 被拒（422，错误信息列未完成子单）；子单出现 CANCELLED 时父单详情出提示（人工裁决继续或取消，不自动阻断）
- 终态（DONE / CANCELLED）无出边，不可再转移；工单不设物理删除（终态即生命周期终点，审计友好）

### 3.3 依赖与留言

- ticket_dependencies(ticketId, blockedByTicketId)：blockedBy 单未 DONE 时，被阻塞单不允许 DISPATCHED（放行前置校验，422）
- DAG 完整性校验（插入时）：禁止自依赖、禁止成环（沿 blockedBy 链检测）；父子约束：仅 STORY 可有子单（parentId 指向的一定是 STORY）
- comments(ticketId, authorType[user/agent/system], authorName, content, createdAt)：双向留言，按时间正序

## 4. API 能力清单

| 端点 | 能力 |
|---|---|
| POST /api/tickets | 建单（type/title/description/parentId） |
| GET /api/tickets | 列表（status/type 筛选；返回父子关系便于树展示） |
| GET /api/tickets/:id | 详情（含依赖、留言、转移历史、子单列表） |
| PATCH /api/tickets/:id | 编辑（仅 DRAFT 态可改 title/description/specContent） |
| POST /api/tickets/:id/spec | 提交 spec：写 specContent + 转 SPEC_READY（冻结） |
| POST /api/tickets/:id/transition | 状态转移（body: to + note；含 STORY 聚合与 blockedBy 校验） |
| POST /api/tickets/:id/comments | 留言 |
| POST/DELETE /api/tickets/:id/dependencies | 依赖管理 |

## 5. 前端页面与交互

**列表页 `/tickets`**：
- 表格列：单号/标题/类型/状态（antd Tag 色分态）/父单/更新时间
- 顶部：状态与类型筛选、新建工单按钮（弹窗：type/title/description/parentId 选择）

**详情页 `/tickets/:id`**：
- 基本信息卡 + 状态操作区（按当前态的**合法后继**动态渲染按钮，如 DRAFT 显示「提交 spec」）
- spec 快照卡：DRAFT 态可编辑，其余态只读
- 依赖区：父单链接 / 子单列表（状态角标）/ blockedBy 列表（可增删）
- 留言流：时间正序 + 发送框
- 时间线：转移历史（from→to + note + 时间）

## 6. 验收标准

| # | 条目 |
|---|---|
| A1 | 手工建 STORY + 子 TASK，走完 DRAFT→SPEC_READY→DISPATCHED→IN_PROGRESS→DONE 全程（API 与 UI 双通道均可） |
| A2 | 非法转移（如 DRAFT→DONE）返回 422，状态不变，转移日志无记录 |
| A3 | 留言提交后详情页可见，时间正序；转移历史在时间线完整呈现 |
| A4 | 子单未全 DONE 时父单 DONE 被拒（错误含未完成子单清单）；全 DONE 后父单可 DONE |
| A5 | blockedBy 单未 DONE 时，被阻塞单 DISPATCHED 被拒 |
| A6 | spec 提交后快照冻结（SPEC_READY 后 PATCH specContent 无效；/transition 无法绕开 /spec 进入 SPEC_READY） |
| A7 | CANCELLED 两条边（SPEC_READY/DISPATCHED → CANCELLED）可用；终态（DONE/CANCELLED）不可再转移；CANCELLED 子单不阻塞父单关单但详情有提示 |

## 7. 非目标

worker 执行 / BLOCKED 与 FAILED / pending 标签 / 聊天框 / worktree / 审计 / 多仓 / 部署形态（本地 `pnpm dev` 跑通即可）。

## 8. 开放点

无重大开放点（框架决策均在 Epic §12 落定）。impl 阶段自行决策项：目录结构细节、Drizzle migration 策略、错误码格式。
