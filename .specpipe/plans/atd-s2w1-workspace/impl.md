# S2w1：Workspace 多项目基座 — impl

- **Story**：atd-s2w1-workspace
- **状态**：v1（2026-09-24）
- **spec**：同目录 spec.md v3（用户已拍板放行）

## 0. 目标

workspace 一等实体落地：声明式加载（workspaces/*.yaml）+ 工单挂载（workspaceId/repoRef）+ worker 按目标仓开 worktree + 前端切换器。S2a 行为零回归（仅 atd.yaml 环境）。

## 1. 改造点总表（文件 × 改动）

| 文件 | 改动 |
|---|---|
| `workspaces/atd.yaml` | **新增**（仓内自带）：id=atd、name=ATD、repos=[{id: atd, path: ., role: primary}] |
| `apps/server/src/workspaces.ts` | **新增** WorkspaceRegistry：加载 workspaces/*.yaml + zod 校验（id kebab-case 唯一/repos id 唯一/primary 恰一/path 存在）+ 查询（list/get/resolveRepo(workspaceId, repoRef?)→绝对路径）；无目录→启动失败（错误含模板指引） |
| `apps/server/src/config.ts` | repoPath 字段转 **optional**（atd.yaml 承担主仓声明）；其余不动 |
| `apps/server/src/db/schema.ts` | tickets 加 `workspaceId`（text, nullable）、`repoRef`（text, nullable） |
| `apps/server/drizzle/0002_s2w1.sql` | **新增** migration：两列 ADD COLUMN + 存量幂等归属 `UPDATE tickets SET workspace_id='atd' WHERE workspace_id IS NULL`（drizzle meta 同步） |
| `apps/server/src/domain/ticket-service.ts` | ① createTicket 入参 +workspaceId（缺省 atd、∈registry 校验）+repoRef（仅 TASK、∈workspace repos、缺省主仓 id）；② parentId 时强制继承父 workspace（异值 422）；③ addDependency 同 workspace 校验（两侧取 workspaceId，NULL 视为已归属态）；④ 放行四件套：repoRef 复校（∈registry 当前集合，防 yaml 漂移）；⑤ 构造注入 WorkspaceRegistry（可选——测试 fixture 统一提供） |
| `apps/server/src/domain/status.ts` | 不动（状态机零变化） |
| `apps/server/src/worktree.ts` | WorktreeManager 去单仓化：`allocate(ticketId, repoPath)` / `reclaim` / `assertReady` 接收仓路径参数（构造不再绑死 repoPath）；内部按 repoPath 计算 repoName 与 worktree 目录 |
| `apps/server/src/dispatcher.ts` | ① spawn 前按 ticket.workspaceId+repoRef 查 registry 解析仓路径传 worktree；② createBlocker 继承父单 workspaceId；③ reopen 沿用原仓（repoRef 不变，零改动确认项） |
| `apps/server/src/app.ts` | 装配顺序：WorkspaceRegistry 先于 worktree/dispatcher；WorktreeManager 构造改造适配 |
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
- 新增测试（vitest，沿用 createTestContext/createRealContext 模式）：
  1. workspaces 加载：合法双仓 yaml 解析正确；path 不存在/双 primary/repo id 重复/ws id 重复/无目录 → 启动失败信息含文件名
  2. 建单契约：workspaceId 未知 422；repoRef 非 TASK 拒；repoRef ∉ repos 422（错误含可选集）；parentId 强制继承（异值 422）
  3. addDependency 跨 workspace 422
  4. 放行复校：建单后 registry 变更（模拟 yaml 漂移）→ 放行 422 repoRef 失效
  5. 存量归属：预置 NULL 行 → 建库迁移后归属 atd（对 migration 的断言走 client.ts 单测）
  6. **跨仓真跑**（createRealContext + fake-done fixture）：双仓 workspace（临时仓 A/B）+ TASK repoRef=B → DONE 后 worktree 目录 `{B仓basename}-t{N}` 且 commit 在 B 仓分支；跨仓编排链（Task1@A DONE → Task2@B 预绑定自动放行 DONE）
  7. S2a 回归：现有测试在 fixture「仅 atd workspace」环境全绿（改造后原样跑）

### 块 B（web）：上表 web 侧全部
- 契约先行（块 A 同步开发，B 按本 impl §3 契约自验）
- 自验：`pnpm -F @atd/web build`（tsc+vite）；有 server 侧分支可 merge 后全栈冒烟（curl 两 workspace 数据源）
- 注意：WorkspaceContext 切换后三页刷新走既有轮询/手动 refetch 机制，不引新轮询

## 3. API 契约（块 A 实现 / 块 B 消费，变更冻结）

```ts
// GET /api/workspaces → 200
{ workspaces: [{ id: string, name: string,
    repos: [{ id: string, path: string, role: 'primary' | 'readable' }],
    primary: string,                    // 主仓 repo id（冗余便于前端）
    ticketCount: number }] }

// GET /api/workspaces/:id → 200 同上单个 | 404
// POST /api/tickets body 新增（均可选）：
{ workspaceId?: string, repoRef?: string }   // 校验规则见 spec FR-3/FR-4
// GET /api/tickets?workspaceId=  可选过滤
// TicketVO 新增：workspaceId: string, repoRef: string | null（TASK 显示用）
```

## 4. 技术决策

- **D1 WorktreeManager 参数化而非多实例**：allocate/reclaim/assertReady 加 repoPath 参数（调用方=dispatcher/guards 已持有 ticket 上下文，解析自 registry）。避免 manager 池生命周期管理。
- **D2 registry 注入 TicketService 可选**：缺省构造「仅含 atd（仓根）」的内置 registry——S2a 旧测试零改造自然通过（建单缺省 atd 合法）。生产装配传真实加载的 registry。
- **D3 存量归属放 migration 0002**（一条 UPDATE，幂等）：DB 状态一次到位，运行时零 NULL 分支。workspace_id 列建为 NOT NULL DEFAULT 'atd' 更彻底——**采用**（列定义 NOT NULL DEFAULT 'atd'，UPDATE 可省略但保留作显式归属动作，见 migration 注释）。
- **D4 guards.assertWorktreeReady 签名扩展**：接收（id, repoPath）——放行四件套在 service 内做 repoRef 复校 + worktree 前置沿用现有 hook。
- **D5 前端「全部」视图建单缺省 atd**：与 API 缺省一致（spec FR-6），弹窗内显式可选覆写。
- **D6 workspaces/*.yaml 加载失败即启动失败**：不降级（spec FR-1，本地系统快速失败）。

## 5. 联调与验收锚点（Oracle 收尾）

1. 双 worktree 合流 → `pnpm install` → `bash .specpipe/fence.sh` 四包全绿
2. 真跑冒烟：本仓声明第二 workspace（临时仓 A/B fixture 或复用测试产物）→ 验收场景 1-5 逐条 curl+页面核对
3. 存量验证：现有 atd.db（tmux atd 实例）重启后存量单归属 atd、页面切换器正常
4. 用户复验后合 main
