# S2w1：Workspace 多项目基座 — impl

- **Story**：atd-s2w1-workspace
- **状态**：v2（2026-09-24，r1 修订：worktree 调用面三处补全/装配通道定义/fixture 环境明确/契约三处补/错误码枚举）
- **spec**：同目录 spec.md v3（用户已拍板放行）

## 0. 目标

workspace 一等实体落地：声明式加载（workspaces/*.yaml）+ 工单挂载（workspaceId/repoRef）+ worker 按目标仓开 worktree + 前端切换器。S2a 行为零回归（仅 atd.yaml 环境）。

## 1. 改造点总表（文件 × 改动）

| 文件 | 改动 |
|---|---|
| `workspaces/atd.yaml` | **新增**（仓内自带）：id=atd、name=ATD、repos=[{id: atd, path: ., role: primary}] |
| `apps/server/src/workspaces.ts` | **新增** WorkspaceRegistry：加载 workspaces/*.yaml + zod 校验（id kebab-case 唯一/repos id 唯一/primary 恰一/path 存在）+ 查询（list/get/resolveRepo(workspaceId, repoRef?)→绝对路径）；path 解析基准=repoRoot（相对）或 `~` 展开（与 config.yaml 同规则）；无目录→启动失败（错误含模板指引） |
| `apps/server/src/config.ts` | repoPath 字段转 **optional**（atd.yaml 承担主仓声明）；其余不动 |
| `apps/server/src/db/schema.ts` | tickets 加 `workspaceId`（text, **NOT NULL DEFAULT 'atd'**）、`repoRef`（text, nullable——BLOCKER/STORY 无仓语义） |
| `apps/server/drizzle/0002_s2w1.sql` | **新增** migration：`ALTER TABLE tickets ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'atd'`（**存量行由 DEFAULT 自动归属 atd，无需 UPDATE**——SQLite ADD COLUMN NOT NULL DEFAULT 语义）+ repo_ref 列 ADD COLUMN NULL；drizzle meta/_journal 同步 |
| `apps/server/src/domain/ticket-service.ts` | ① createTicket 入参 +workspaceId（缺省 atd、∈registry 校验）+repoRef（仅 TASK、∈workspace repos、**缺省=主仓 id 且落库实际值**——DB 无 NULL 歧义）；② parentId 时强制继承父 workspace（异值 422）；③ addDependency 同 workspace 校验（两侧 workspaceId 比对）；④ 放行四件套：**仅 user 通道**做 repoRef 复校（registry.resolveRepo 失败→422 REPO_REF_DRIFTED 含修复指引：改 yaml 或裁决终止）；⑤ 构造注入 WorkspaceRegistry（见 D2）；⑥ createBlocker 落库时从父单行继承 workspaceId（单点收口） |
| `apps/server/src/domain/status.ts` | 不动（状态机零变化） |
| `apps/server/src/worktree.ts` | WorktreeManager 去单仓化：`allocate(ticketId, repoPath)` / `reclaim(ticketId, repoPath, keepBranch)` / `assertReady(id, repoPath)` / `pathFor(ticketId, repoPath)` 全部接收仓路径参数；内部按 repoPath 计算 repoName 与 worktree 目录。**调用面三处**：①dispatcher（allocate/assertReady）②guards 链（ticket-service 放行四件套经 DispatchGuards）③`routes/execution.ts:102` reclaim（经 runtime 解析仓路径） |
| `apps/server/src/dispatcher.ts` | ① spawn 前按 ticket.workspaceId+repoRef 查 registry 解析仓路径传 worktree；② createBlocker 经 ticket-service 落库（workspaceId 继承**收口在 createBlocker 单点**——从父单行读，dispatcher 不另写字段）；③ reopen 沿用原仓（repoRef 不变，零改动确认项）；④ **system 自动放行链（onTicketSettled）不做 repoRef 复校**——解析失败走既有 preSpawnFail CANCELLED（可重派语义保留） |
| `apps/server/src/app.ts` | **装配通道**：AppRuntime 与 DispatcherDeps 各 +`workspaces: WorkspaceRegistry`；buildServer 的 RuntimeOptions +`workspaces`；装配顺序 workspaces（先）→ worktree → dispatcher → routes |
| `apps/server/src/index.ts` | 启动入口加载 WorkspaceRegistry（`loadWorkspaces(repoRoot)`，失败即退出并打印文件名与原因）传入 buildServer |
| `apps/server/src/domain/errors.ts` | 新错误码枚举：`WORKSPACE_UNKNOWN`（建单未知 workspace）/`REPO_REF_INVALID`（∉repos，details 含可选集）/`REPO_REF_DRIFTED`（放行复校失败，含修复指引）/`CROSS_WORKSPACE`（父子/依赖跨 workspace） |
| `apps/server/src/routes/types.ts` | 路由层共享类型镜像：Workspace/WorkspaceRepo/TicketVO 扩展字段（与 zod 同步） |
| `apps/server/src/routes/execution.ts` | reclaim 调用点改传仓路径：`runtime.worktree.reclaim(id, repoPath, keepBranch)`——repoPath 经 runtime.workspaces.resolveRepo(ticket) 解析（resolve 失败=已删 yaml，用原 repoRef 反查不可得时 422 REPO_REF_DRIFTED） |
| `apps/server/src/routes/tickets.ts` | ① 建单 body +workspaceId/+repoRef（zod）；② 列表 query +workspaceId（可选过滤）；③ GET /api/workspaces、GET /api/workspaces/:id（新路由可独立文件 routes/workspaces.ts） |
| `apps/web/src/api/types.ts` | +Workspace/RepoRef 类型、TicketVO +workspaceId/repoRef、建单/列表参数扩展 |
| `apps/web/src/api/tickets.ts` | +listWorkspaces/getWorkspace、建单/列表透传新参数 |
| `apps/web/src/context/WorkspaceContext.tsx` | **新增**：当前 workspace 全局态（useState+Context；「全部」=null；localStorage 持久化） |
| `apps/web/src/components/AppLayout.tsx` | 顶栏切换器（Select：全部+各 workspace「显示名 · 主仓名」） |
| `apps/web/src/components/CreateTicketModal.tsx` | +workspace 选择（缺省当前切换器所选，全部视图缺省 atd）+TASK 目标仓下拉（所选 workspace repos，主仓标「主」缺省）+父单候选按 workspace 过滤 |
| `apps/web/src/pages/{Workbench,Dashboard,TicketList}Page.tsx` | 列表请求透传 workspaceId（切换器联动） |
| `apps/web/src/pages/TicketDetailPage.tsx` + 列表行组件 | 非主仓 repoRef 显示目标仓名 Tag |

## 2. 任务切分（双 Builder 并行，文件集不相交）

### 块 A（server）：上表 server 侧全部 + atd.yaml + 测试
- 自验：`pnpm -F @atd/server exec tsc --noEmit && pnpm -F @atd/server test`
- **helpers.ts 改造**（测试基建，随块 A）：createTestContext/createRealContext 构造 fixture workspaces 目录（临时目录写入 atd.yaml + 按需双仓 yaml），loadWorkspaces 加载后注入 service/dispatcher；worktreeGuard 维持 skip。**既有 worktree/dispatcher 测试文件因 allocate 等签名变更需同步适配**（tsconfig include test，编译期即暴露——不是「原样跑」，是「适配后语义等价」）
- 新增测试（vitest，沿用 createTestContext/createRealContext 模式）：
  1. workspaces 加载：合法双仓 yaml 解析正确；path 不存在/双 primary/repo id 重复/ws id 重复/无目录 → 加载失败信息含文件名；相对 path（基于 repoRoot）与 `~` 展开两种形态解析正确
  2. 建单契约：workspaceId 未知 422 WORKSPACE_UNKNOWN；repoRef 非 TASK 拒；repoRef ∉ repos 422 REPO_REF_INVALID（details 含可选集）；parentId 强制继承（异值 422 CROSS_WORKSPACE）
  3. addDependency 跨 workspace 422 CROSS_WORKSPACE
  4. 放行复校（user 通道）：建单后**替换注入的 registry 实例**（模拟 yaml 漂移——移除该 repo）→ 放行 422 REPO_REF_DRIFTED
  5. 存量归属（migration 断言，client.ts 单测）：预建旧 schema 库含数据行 → migrate 后 workspace_id 全部='atd'（ADD COLUMN DEFAULT 语义）
  6. **跨仓真跑**（createRealContext + fake-done fixture）：双仓 workspace（临时仓 A/B）+ TASK repoRef=B → DONE 后 worktree 目录 `{B仓basename}-t{N}` 且 commit 在 B 仓分支；跨仓编排链（Task1@A DONE → Task2@B 预绑定自动放行 DONE；system 链解析失败走 preSpawnFail 的负例可选）
  7. S2a 回归：现有测试适配后全绿（fixture 环境仅含 atd workspace；缺省 workspace=atd、缺省 repoRef=主仓，行为与 S2a 等价）

### 块 B（web）：上表 web 侧全部
- 契约先行（块 A 同步开发，B 按本 impl §3 契约自验）
- 自验：`pnpm -F @atd/web build`（tsc+vite）；有 server 侧分支可 merge 后全栈冒烟（curl 两 workspace 数据源）
- 注意：WorkspaceContext 切换后三页刷新走既有轮询/手动 refetch 机制，不引新轮询

## 3. API 契约（块 A 实现 / 块 B 消费，变更冻结）

```ts
// GET /api/workspaces → 200
{ workspaces: [{ id: string, name: string,
    repos: [{ id: string, path: string, role: 'primary' | 'readable' }],  // path=解析后绝对路径
    primary: string,                    // 主仓 repo id（冗余便于前端）
    ticketCount: number }] }

// GET /api/workspaces/:id → 200 { workspace: { …同上单个 } } | 404
// POST /api/tickets body 新增（均可选）：
{ workspaceId?: string, repoRef?: string }   // 校验规则见 spec FR-3/FR-4
//   repoRef 落库语义：缺省=主仓 id，落实际值（TicketVO 恒返回非 null——TASK）；非 TASK 单 null
// GET /api/tickets?workspaceId=  可选过滤
// TicketVO 新增：workspaceId: string（恒有）, repoRef: string | null（仅 TASK 非 null）
// 错误码：WORKSPACE_UNKNOWN / REPO_REF_INVALID / REPO_REF_DRIFTED / CROSS_WORKSPACE（均 422）
```

## 4. 技术决策

- **D1 WorktreeManager 参数化而非多实例**：allocate/reclaim/assertReady/pathFor 加 repoPath 参数。**调用方三处**：dispatcher（spawn 链）、guards（放行四件套经 DispatchGuards）、routes/execution.ts（reclaim）。避免 manager 池生命周期管理。
- **D2 registry 注入 TicketService 必选**（构造参数）：测试 fixture 与生产统一走 loadWorkspaces 产物——helpers 构造临时 workspaces 目录（最小内容=atd.yaml 指向 dummy repo 路径），不存在「无 registry」分支。config.repoPath 转 optional 后**不再参与装配**（主仓声明唯一来源=workspaces yaml；内置兜底仅存在于 loadWorkspaces 的文档指引）。
- **D3 workspace_id 列 NOT NULL DEFAULT 'atd'**：SQLite ADD COLUMN ... NOT NULL DEFAULT 对存量行自动填值——零 UPDATE、迁移一步到位（0001_s2a.sql 的 pending_label DEFAULT 先例同款）。repo_ref 可空（非 TASK 无仓语义）。**对 spec FR-2「日志留痕」的显式豁免**：归属动作由 migration DEFAULT 原子完成（优于启动期 UPDATE+日志的时序窗口）；启动时打印一次 migration 摘要（drizzle 既有输出）即为留痕载体。
- **D4 guards.assertWorktreeReady 签名扩展**：接收（id, repoPath）——放行四件套在 service 内做 repoRef 复校 + worktree 前置沿用现有 hook。
- **D5 前端「全部」视图建单缺省 atd**：与 API 缺省一致（spec FR-6），弹窗内显式可选覆写。
- **D6 workspaces/*.yaml 加载失败即启动失败**：不降级（spec FR-1，本地系统快速失败）；错误信息含「参照仓内 workspaces/atd.yaml 模板」指引。
- **D7 BLOCKER 的 workspaceId 继承收口 createBlocker 单点**（ticket-service）：dispatcher 不另写字段；父单行直读。
- **D8 system 自动放行链不复校 repoRef**：onTicketSettled 触发的自动放行直接 DISPATCHED；spawn 时 registry 解析失败走既有 preSpawnFail→CANCELLED（可重派语义），与 user 通道的 422 REPO_REF_DRIFTED 分流（人工通道给修复指引，系统通道给可重派状态）。

## 5. 联调与验收锚点（Oracle 收尾）

1. 双 worktree 合流 → `pnpm install` → `bash .specpipe/fence.sh` 四包全绿
2. 真跑冒烟：本仓声明第二 workspace（临时仓 A/B fixture 或复用测试产物）→ 验收场景 1-5 逐条 curl+页面核对
3. 存量验证：现有 atd.db（tmux atd 实例）重启后存量单归属 atd、页面切换器正常
4. 用户复验后合 main
