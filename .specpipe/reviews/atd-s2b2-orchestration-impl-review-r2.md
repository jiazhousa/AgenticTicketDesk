# 审查报告: atd-s2b2-orchestration — Impl (Revision 2)

- **审查类型**：Story Impl 完整审查（r2，对 r1 REJECT 63 的 7 项逐条闭合核验 + 编辑残留快扫 + 块间文件集终核）
- **审查对象**：`.specpipe/plans/atd-s2b2-orchestration/impl.md`（v2，77 行，commit `54f93b8`）
- **基准材料**：`atd-s2b2-orchestration-impl-review-r1.md`（REJECT 63：2 high + 1 medium + 4 low）；同目录 `spec.md`（v3.1）；`AGENTS.md`
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（main@d1c9dd9，工作区干净——仅 .stage/.stage-history 元数据变更，只读核验）
- **核对面**：`apps/server/src/{app.ts,workspaces.ts,dispatcher.ts,domain/{errors,routes/types}.ts,humanthink/{config-gen,routes}.ts}`、`apps/server/test/humanthink/config-gen.test.ts`、`apps/web/src/{api/{tickets,types,humanthink}.ts,components/chat/ChatMessage.tsx,pages/HumanThinkPage.tsx}`
- **状态校验**：`.stage` = `IMPL_REVIEWING` ✓（与派发口径一致）
- **日期**：2026-09-26

## 总体评价

**通过**——r1 的 2 high + 1 medium 全部闭合，4 项 low 中 3 项闭合、1 项部分闭合（残余均无阻塞性）。v2 修订准确命中 r1 根因：`app.ts` 入块 1 并补 `id`/`primary`+workers 清单（h1 数据链路闭合）、confirm 改 200 双态并冻结 `PlanIssue.field` 值域（h2 契约冲突三处一次性消除）、放行提取两层定型（m 语义自洽）。编辑残留快扫未见 contract/routes/web 三面口径漂移。块间文件集不相交、web 三文件链完备。判 **PASS**，落定 `IMPL_APPROVED`。

## r1 → v2 七项闭合核验

| # | r1 问题 | v2 落点 | 代码事实核对 | 判定 |
|---|---|---|---|---|
| h1 | 块 1 漏 `app.ts`（装配通道）+ repos 丢 `id`/`primary` + workers 未进链路 | impl:6/11/26 | `buildServeConfig` 唯一调用点 `app.ts:224-227`，现映射 `({id, repos: [{path, role}]})` **确实丢 id/primary**；`VisionWorkspace.repos` 类型 `config-gen.ts:15-18` 仅 `{path, role}`；worker 清单未进链路。`Workspace`/`WorkspaceRepo` 源类型 `workspaces.ts:8-11` **已含 `id` 与 workspace 级 `primary`**（映射层丢字段属实）；`runtime.registry` 在 `buildServeConfig` 调用作用域可见（`app.ts:156-164` + `222-227` 同闭包） | ✅ 闭合 |
| h2 | confirm 失败契约 `422+VALIDATION+details:PlanIssue[]` 与错误信封/状态映射双重冲突，`field` 值域未冻结 | impl:16/28/51-54 | `ERROR_STATUS.VALIDATION=400`（`errors.ts:29`）、`details?: string[]` 三处（`routes/types.ts:20`/`errors.ts:60`/`web/api/tickets.ts:30`）、web 两通道 `join('；')`（`tickets.ts:62-63`/`humanthink.ts:41-43`）。v2 改 **200 双态**（validate 200 恒定 / confirm 200 双态）**完全绕开信封**，`PlanIssue.field` 冻结为 `repoRef|workerId|dependsOn|plannedFiles|id|title|spec`——三处冲突（状态码/类型/标红定位）一次性消除 | ✅ 闭合 |
| m | `releaseChainReady` 提取粒度使「行为不变」不自洽 | impl:17/30/63 | 既有 `onTicketSettled`（`dispatcher.ts:534-573`）结构=下游枚举(:538-542) + per-ticket 判据(:548-558) + `transition`(:559) + 条件 `onDispatched`(:564-566)。v2 定为**私有 `tryReleaseChainTicket`（逐票判据+副作用）+ 双枚举入口**（`onTicketSettled` 轴=下游 / `releaseChainReady(storyId)` 轴=子单），两入口候选集不同、判据与副作用单一实现——语义自洽，「行为不变」可证 | ✅ 闭合 |
| l1 | 测试面缺装配前提 + 验收 5/6 无断言 | impl:32 | 装配前提已写（fake-serve 上下文 + helpers 旁路 + spawn 计数允许 0，状态转移为准）；`config-gen.test.ts` WS fixture(`test:14-23`) 与旁路语义核对成立。**但 r1 建议的两条断言（多轮各自成链/泳道跳转目标 id）未补入用例清单** | ⚠ 部分闭合（残余 low-2） |
| l2 | plan 两端点门卫口径未声明 | impl:28/32 | v2 冻结为「门卫同既有（assertAvailable/已删三分）」并在 plan.test 行落用例（degraded 503 / 已删会话 422）。口径声明 + 用例齐备（选挂 `assertAvailable` 为设计决策，已显式定型） | ✅ 闭合 |
| l3 | 端点计数漂移（9→11） | impl:28 | `routes.ts:13` 与 `web/api/humanthink.ts:2` 确有「9 端点」；v2 三处（routes 文件头 + web api + routes/types.ts）勘误为 11。**残留：`web/api/humanthink.ts:24`「（9 端点共用）」非文件头未被「文件头」措辞覆盖；且 `routes/types.ts` 实无「9 端点」注释而 `test/api-s2b1.test.ts:13/89` 有** | ⚠ 部分闭合（残余 low-3） |
| l4 | 单事务落点与同步约束未写明 | impl:16 | v2 写明：外层 `db.transaction` 包 service 调用、嵌套走 savepoint、**回调禁 async**、事务提交后**同步**放行——与 drizzle/better-sqlite3 嵌套 savepoint 事实（r1 已核）一致 | ✅ 闭合 |

## 编辑残留快扫

- **契约冻结节 ↔ routes.ts 行双态口径一致**：impl:28（validate 200 恒定 / confirm 200 双态）与 impl:51-52（同口径）**逐字对齐**，无冲突残留 ✓
- **`ok:true` 响应形与 web 手抄面一致**：`{ok, story:{id}, tasks:[{localId,id}]}`（impl:16/52）↔ web 跳转目标 `/tickets/:storyId` 取 `story.id`（impl:18）↔ 块 2 手抄义务（impl:45）同源 ✓
- **无 `422` 陈旧口径残留**：全文含 `422` 仅出现在 plan 端点门卫（已删会话三分语义，impl:28/32），confirm 校验失败路径已彻底去信封化 ✓
- **仅一处命名残留**：D6（impl:63）写「两入口（`onTicketSettled`/`planConfirmed`）」，与正文/块 1 的 `releaseChainReady(storyId)` 不一致（见 low-1）
- **`releaseChainReady` 全文一致**：技术方案 6 / 块 1 dispatcher 行命名统一（除 D6）✓

## 块间文件集终核

- **不相交性成立**：块 1=`apps/server/**`（含 `routes/types.ts` 契约镜像，`app.ts` 归入后仍全在 server 侧）；块 2=`apps/web/**`。**无交叉** ✓（impl:26-33 vs impl:41-45）
- **web 三文件链完备**：`ChatMessage.tsx`（assistant markdown 唯一挂点 `:132-140`——r2 复核唯一）→ `PlanCard.tsx`（新）→ `HumanThinkPage.tsx`（唯一调用点 `:687`，回调/校验透传）→ `api/humanthink.ts`（+2 端点）→ `api/types.ts`（手抄镜像）。PlanCard 的 repos/workers Select 数据源经既有 `getWorkspace`/`getWorkers`（`web/api/tickets.ts:172/186`）可达，`WorkspaceRepo.id`（`web/api/types.ts:28-33`）齐备——**链无断点** ✓
- **契约冻结节位置正确**：位于两块之间（impl:49-54），满足「契约运行时与类型同块拥有」，作为块 2 并行唯一事实源 ✓

## 发现的问题（均 low，不阻塞）

1. **D6 入口命名残留 `planConfirmed`** — 严重程度：low
   - 位置：impl:63（D6「两入口（`onTicketSettled`/`planConfirmed`）」）
   - 影响：与正文/块 1 的 `releaseChainReady(storyId)` 命名不一致，Builder 可能自造第二名称；无行为面影响
   - 建议：D6 改为 `releaseChainReady(storyId)` 与正文统一（一行勘误，可并入下次编辑）

2. **验收 5/6 断言仍未补入 plan.test 用例清单** — 严重程度：low
   - 位置：impl:32（用例清单）
   - 影响：r1 low-5 建议的「同会话连续两次 confirm 生成两条互不影响链」（验收 6）与「STORY 详情跳转目标 id 取自 confirm 响应」（验收 5）未落测试行；核心链路（校验/原子性/放行/排队/跨仓/门卫）已覆盖，属验收断言完整性残余
   - 建议：后续轮次或 Builder 执行时补 2 条断言

3. **端点计数勘误覆盖不全** — 严重程度：low
   - 位置：impl:28
   - 影响：`web/api/humanthink.ts:24`「（9 端点共用）」非文件头、未被措辞覆盖；`routes/types.ts` 实无「9 端点」注释而 `test/api-s2b1.test.ts:13/89` 有——按字面执行可能漏改/误改
   - 建议：块 1 行补「同文件 `:24` 括号注一并勘误」，`routes/types.ts` 项改为「契约镜像区补 4 类型」、test 标题按需

4. **`primary` 映射与 `VisionWorkspace` 类型字段对应未写死** — 严重程度：low
   - 位置：impl:11/26（「`VisionWorkspace.repos` 类型补 `id`」+「映射补 `id`/`primary`」）
   - 影响：若映射对象加 workspace 级 `primary: ws.primary`，`VisionWorkspace` 需同步加字段，否则对象字面量 excess property 报错；`config-gen.test.ts` WS fixture (`:14-23`) 亦须随 `repos.id` 必填同步。二者均被 tsc 强制暴露（该文件已在块 1 表内），不构成实现阻塞
   - 建议：块 1 app.ts 行补「`VisionWorkspace` 补 `primary` 字段；WS fixture 同步补 `id`」一句

> 附：`validate` 挂 `assertAvailable`（impl:28）使 serve 降级期无法预检——r1 low-6 曾建议不挂。v2 选择继承既有 503 语义并已显式冻结 + 落用例，属可辩护的定型，不计分，仅备验。

## 结论

# PASS

状态：IMPL_REVIEWING → IMPL_APPROVED

> 一句话理由：r1 的两项 high（app.ts 装配数据链路 / confirm 契约冲突）与一项 medium（放行提取粒度）经代码事实逐条核验**全部闭合**，4 项 low 中 3 项闭合、1 项部分闭合；残留 4 项均为一行级勘误/断言补全（无 medium+，不含阻塞缺陷），块间文件集不相交、契约冻结节可作块 2 并行唯一事实源，判 PASS。未修改 impl 正文与任何业务代码。
