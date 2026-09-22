# Story Impl：S1 核心域骨架（工单 CRUD / 状态机 / DAG / 留言 + 最小看板）

- **topic**：atd-s1-core-domain
- **上游 spec**：`../atd-s1-core-domain/spec.md`（v2 已放行，验收 A1-A7 为唯一验收来源）
- **状态**：S-S6 修订 v2（落实 r1 审查：API 契约字段级锚定/A7 锚点/migration 决策/8 low），待二审
- **日期**：2026-09-22
- **包名约定**：`@atd/server` / `@atd/web`（根 `-F` 过滤用包名，非目录名）

---

## 0. 总体技术决策

| 项 | 决策 |
|---|---|
| 运行时 | Node ≥22.19，ESM（`"type": "module"`），TypeScript strict |
| monorepo | pnpm workspace（`apps/*`）；根 dev 用 `pnpm --parallel --filter "./apps/*" dev`（不引 concurrently） |
| 后端 | Fastify 5 + `@fastify/cors` + Drizzle ORM + better-sqlite3 + zod |
| 前端 | Vite + React 18 + antd 5 + react-router 6 + 原生 fetch 封装 |
| 测试 | vitest；服务层单测（内存库）+ API 层 `fastify.inject()`（内存库） |
| DB 文件 | 开发库 `apps/server/data/atd.db`（gitignore）；测试库 `:memory:` |
| migration | **drizzle-kit generate 产出 SQL 进仓**（`apps/server/drizzle/*.sql`）；server 启动时 `migrate()` 自动执行；**测试库用同一套 migration 初始化**（每测试文件独立内存实例） |
| 注释规范 | 只写终态注释与 TODO，中文 |

**同步驱动三条铁则**（better-sqlite3）：
1. 事务回调内只写同步代码（禁 await 异步 API）
2. 连接建立即执行 `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`
3. drizzle 的 text 枚举不生成 DB CHECK——枚举值域由 zod 入参校验兜底（schema 注释标明）

## 1. 数据库 schema（Drizzle → migration）

```
tickets            id INTEGER PK AUTOINCREMENT（单号语义 #N）
                   type TEXT NOT NULL（'STORY'|'TASK'|'BLOCKER'|'DREAM'）
                   title TEXT NOT NULL / description TEXT
                   status TEXT NOT NULL（六态）
                   parent_id INTEGER REFERENCES tickets(id) NULL
                   spec_content TEXT / worker_id TEXT
                   created_at / updated_at INTEGER NOT NULL(ms)
ticket_dependencies id PK / ticket_id FK / blocked_by_ticket_id FK / created_at
                   UNIQUE(ticket_id, blocked_by_ticket_id)
comments           id PK / ticket_id FK / author_type（'user'|'agent'|'system'）/ author_name / content / created_at
ticket_transitions id PK / ticket_id FK / from_status / to_status / operator / note / created_at
```

- 父子约束（仅 STORY 可有子）与 DAG 校验（禁自依赖/禁环=沿 blockedBy DFS）在**服务层**校验
- 无软删列：终态即终点

## 2. 状态机与核心服务（apps/server/src/domain/）

### 2.1 转移白名单

```ts
const TRANSITIONS: Record<Status, Status[]> = {
  DRAFT:        ['SPEC_READY'],
  SPEC_READY:   ['DISPATCHED', 'CANCELLED'],
  DISPATCHED:   ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS:  ['DONE'],
  DONE:         [],
  CANCELLED:    [],
};
```

### 2.2 `transition(ticketId, to, operator, note)`——事务内（同步回调）

1. 读单（不存在 → 404 `NOT_FOUND`）
2. 白名单校验（非法 → 422 `INVALID_TRANSITION`）
3. **to=SPEC_READY 一律拒绝**（422 `USE_SPEC_ENDPOINT`）
4. to=DISPATCHED：blockedBy 门——所有 blockedBy 单须 DONE，否则 422 `BLOCKED_BY_PENDING`（details: 未完成依赖单数组）
5. to=DONE 且 type=STORY：聚合门——子单须全部 DONE/CANCELLED，否则 422 `CHILDREN_PENDING`（details: 未完成子单数组）
6. UPDATE status + updated_at，INSERT ticket_transitions；返回更新后实体

### 2.3 `submitSpec(ticketId, specContent)`——独立路径，不经 transition()

1. 读单，须 DRAFT（否则 422 `NOT_DRAFT`）；specContent zod 非空
2. UPDATE spec_content + status='SPEC_READY' + updated_at，INSERT ticket_transitions（from=DRAFT to=SPEC_READY，note='submit spec'）

### 2.4 错误码全集（服务层 throw `AppError(code,message,details?)`，Fastify `setErrorHandler` 统一包裹）

`NOT_FOUND`(404，单不存在或 blockedBy 目标不存在) / `VALIDATION`(400，zod) / `INVALID_TRANSITION`(422) / `USE_SPEC_ENDPOINT`(422，任意来源态) / `NOT_DRAFT`(422) / `BLOCKED_BY_PENDING`(422) / `CHILDREN_PENDING`(422) / `DAG_INVALID`(422，自依赖/成环/父子约束统一此码，details 区分)

## 3. API 契约（块 A/B 唯一契约面，字段级）

统一包裹：成功=资源 JSON 本体；失败=`{ "error": { "code", "message", "details"?: string[] } }`。
TypeScript 类型放 `apps/server/src/routes/types.ts`（B 侧以此为参照抄类型，**不跨包 import**）。

### 3.1 POST /api/tickets
- req: `{ type: 'STORY'|'TASK', title: string, description?: string, parentId?: number }`（BLOCKER/DREAM 暂不接受创建，400）
- 校验：parentId 存在且为 STORY（否则 `DAG_INVALID`）
- res 201: `Ticket`

### 3.2 GET /api/tickets?status=&type=
- res 200: `{ items: (Ticket & { childrenCount: number; parentTitle: string | null })[] }`

### 3.3 GET /api/tickets/:id
- res 200: `{ ticket: Ticket, children: Ticket[], dependencies: Ticket[], comments: Comment[], transitions: Transition[], hasCancelledChildren: boolean }`
  - `dependencies` = blockedBy 指向的单列表
  - `hasCancelledChildren`：存在 CANCELLED 子单时 true——**A7 提示锚点**（前端据此渲染告警条）

### 3.4 PATCH /api/tickets/:id
- 仅 DRAFT（否则 422 `NOT_DRAFT`）；req: `{ title?, description?, specContent? }`（至少一项）
- res 200: `Ticket`

### 3.5 POST /api/tickets/:id/spec
- req: `{ specContent: string }`；走 submitSpec
- res 200: `Ticket`（status=SPEC_READY）

### 3.6 POST /api/tickets/:id/transition
- req: `{ to: Status, note?: string }`；operator 固定 'user'（S1 单用户）
- res 200: `Ticket`

### 3.7 POST /api/tickets/:id/comments
- req: `{ content: string }`；authorType='user'，authorName='我'（S1 固定）
- res 201: `Comment`

### 3.8 POST /api/tickets/:id/dependencies
- req: `{ blockedByTicketId: number }`；DAG 校验（自依赖/环/自身存在）失败 422
- res 201: `{ ok: true }`
- DELETE /api/tickets/:id/dependencies/:blockedById → 204

`Ticket = { id, type, title, description, status, parentId, specContent, workerId, createdAt, updatedAt }`；`Comment/Transition` 同 §1 字段（API 层 camelCase，DB snake_case 由 Drizzle 映射——§1 为 DB 侧命名）。

契约补注：① 列表默认排序 `createdAt DESC`；② 建单初始 status 固定 `DRAFT`；③ `to=SPEC_READY` 的拒绝（USE_SPEC_ENDPOINT）对任意来源态生效。

## 4. 前端结构（apps/web/src/）

```
pages/TicketListPage.tsx    表格+筛选+新建弹窗
pages/TicketDetailPage.tsx  编排四卡布局；hasCancelledChildren=true 时顶部 antd Alert「存在已取消子单，请裁决」
components/StatusTag.tsx         六态色分（DRAFT默认/SPEC_READY蓝/DISPATCHED青/IN_PROGRESS橙/DONE绿/CANCELLED灰）
components/TransitionActions.tsx 按当前态渲染：DRAFT→「提交 spec」（POST /spec，非 transition）；其余态→合法后继按钮（POST /transition）；服务端 422 错误 message 直接 toast
components/SpecCard.tsx          DRAFT 可编辑（含 specContent）/其余只读
components/DependencyPanel.tsx   父单链接/子单列表（StatusTag 角标）/blockedBy 增删
components/CommentStream.tsx     留言流+发送框
components/Timeline.tsx          转移历史（from→to + note）
api/tickets.ts                   fetch 封装（统一 error.code 感知 + 失败 toast）
api/types.ts                     与 §3 契约一致的 TS 类型（手抄同步，注释指向 server types.ts）
```

- vite proxy：`'/api' → http://localhost:3001`

## 5. 任务切分（两 Builder 并行，文件集不相交）

| 块 | 文件集 | 验证命令 |
|---|---|---|
| **A 后端**（分支 dev/feat/atd-s1-core） | `pnpm-workspace.yaml`、根 `package.json`、`tsconfig.base.json`、`.gitignore`（追加 node_modules/dist/db 文件）、`pnpm-lock.yaml`、`apps/server/**`（全部含测试与 drizzle migration） | `pnpm install && pnpm -F @atd/server test` |
| **B 前端**（分支 dev/feat/atd-s1-web） | `apps/web/**`（**全部**，含自建 package.json/vite 配置）、根 `README.md` | 不跑 install/build（无依赖环境）——文件级交付：与 §3 契约和 `apps/server/src/routes/types.ts` 类型对齐，tsc 语法自查；编译验证由 Oracle 收尾统一执行 |

- 契约面：B 只依赖 §3 字段契约 + `apps/server/src/routes/types.ts` 作类型参照（抄不引）
- **两块两个 worktree 两个分支**（基于 main），文件集零交叉（A 不建任何 web 文件）；收尾 Oracle 合流两分支 → 全量 install 重生成 lockfile → 统一验证
- **commit 纪律**：完成即 commit（各自 worktree 各自分支，无交叉暂存问题），中文 message

## 6. 测试清单（vitest，块 A 交付；每行标注验收锚点）

| 文件 | 用例与断言锚点 |
|---|---|
| `state-machine.test.ts` | 六边各一例合法转移（断言 status 变更 + transitions 落一行）【A1】；DRAFT→DONE 等 8 组非法 → 422 INVALID_TRANSITION 且 status 不变 **且 transitions 表零新增**【A2】；transition(to=SPEC_READY) → 422 USE_SPEC_ENDPOINT【A6】；DONE/CANCELLED 无出边（任一 to 均拒）【A7】 |
| `ticket-service.test.ts` | 聚合门：3 子未全 DONE→父 DONE 422 CHILDREN_PENDING 且 details 列出未完成子单 id【A4】；全 DONE→通过【A4】；一子 CANCELLED+余 DONE→通过且 hasCancelledChildren=true【A4/A7】；blockedBy 未 DONE→DISPATCHED 422 BLOCKED_BY_PENDING details 列依赖单【A5】；DAG：自依赖/两单互为依赖环/parentId 非 STORY → 422【spec §3.3】；spec 冻结：SPEC_READY 后 PATCH specContent → 422 NOT_DRAFT，字段未变【A6】 |
| `api.test.ts`（fastify.inject） | 全链：POST 建 STORY+2 子 TASK→子各自 POST /spec→transition DISPATCHED→IN_PROGRESS→DONE（第二个走 blockedBy 先拒后过）→父单 DONE【A1】；留言 POST 后 GET 详情含正序 comments【A3】；GET 详情含 transitions 时间线【A3】；422 响应体含 error.code/message/details【A2】；PATCH 成功路径：DRAFT 改 title/specContent 生效【A1 前置】；DELETE /dependencies 后 blockedBy 门解除（原被阻塞单可 DISPATCHED）【A5】 |

## 7. 工程与收尾（Oracle 执行，不派 Builder）

- worktree ×2：`git worktree add ../AgenticTicketDesk-s1a -b dev/feat/atd-s1-core`（块 A）、`git worktree add ../AgenticTicketDesk-s1b -b dev/feat/atd-s1-web`（块 B），均基于 main（主 worktree 不动）
- 收尾统一验证（合流后）：merge 两分支到 dev/feat/atd-s1-core-domain → 全量 `pnpm install`（重生成 lockfile）→ `pnpm -F @atd/server test && pnpm -F @atd/web build` → `pnpm dev` 冒烟（列表/详情/全链流转/留言/CANCELLED 告警各点一遍）
- 分支不合 main（等用户验收 S1 后决定）

## 8. 非目标重申

无 worker 执行、无 BLOCKED/FAILED、无聊天框、无 worktree 池、无审计、无多仓、无部署产物。
