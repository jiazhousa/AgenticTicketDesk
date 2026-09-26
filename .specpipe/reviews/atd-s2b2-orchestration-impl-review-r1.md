# 审查报告: atd-s2b2-orchestration — Impl (Revision 1)

- **审查类型**：Story Impl 完整审查（r1，对 spec v3.1 逐条落点 + 任务块完备性 + 可实现性挂点核验）
- **审查对象**：`.specpipe/plans/atd-s2b2-orchestration/impl.md`（v1，75 行，commit `1cb77ac`）
- **基准材料**：同目录 `spec.md`（v3.1，SPEC_APPROVED）；`atd-s2b2-orchestration-spec-review-r1/-r2.md`（r1 REJECT 84 → r2 PASS 98）；Epic §4.3/§9；`AGENTS.md`；教训清单先例 `atd-s2b1-humanthink-impl-review-r1.md`（文件集完备/装配通道真实性/测试落点/契约同块拥有/web 手抄义务）
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（main@d1c9dd9 + docs commit `1cb77ac`，工作区干净，只读核验）
- **核对面**：`apps/server/src/{app.ts,domain/{ticket-service,errors,status}.ts,dispatcher.ts,humanthink/{config-gen,routes}.ts,routes/{tickets,types}.ts}`、`apps/server/test/{helpers.ts,humanthink/config-gen.test.ts,dispatcher.test.ts}`、`apps/web/src/{App.tsx,pages/HumanThinkPage.tsx,components/chat/ChatMessage.tsx,api/{tickets,humanthink,types}.ts}`、`node_modules` 侧事务实现（drizzle better-sqlite3 `session.js`、better-sqlite3 `transaction.js`）
- **状态校验**：`.stage` = `IMPL_REVIEWING` ✓（与派发口径一致）
- **日期**：2026-09-26

## 总体评价

**不通过**——技术方案主体方向正确、可实现性挂点经代码核对**大部分真实**（尤其本报告重点关注的「单事务建单」挂点**成立**，见下节），但存在 **2 项 high + 1 项 medium**：块 1 文件集漏 `apps/server/src/app.ts`（`buildServeConfig` 装配通道必改，且 `VisionWorkspace`/app 侧映射丢 repo **id** 与 `primary`，产出合同的 repoRef 取值域无从生成）；confirm 失败契约 `422 + code:'VALIDATION' + details: PlanIssue[]` 与既有错误信封/状态映射**双重冲突**（`VALIDATION→400`；`details` 两侧皆 `string[]` 且 web 会 `join('；')`），且 `PlanIssue.field` 值域未冻结；`releaseChainReady(storyId)` 提取语义与「`onTicketSettled` 行为不变」在不同候选枚举源下不自洽。上述三项均为改文档即回的编码前缺陷，判 **REJECT**，回退 `IMPL_DRAFT`。

## 评分

**63 / 100**（critical×0 / high×2 = −24 / medium×1 = −5 / low×4 = −8）

## spec v3.1 覆盖核对（验收 1-8 / 规则 1-9）

| 基准项 | impl 落点 | 判定 |
|---|---|---|
| 验收 1 产出（调研→spec+计划卡，业务语言） | 技术方案 1（系统提示产出合同+动态清单）+ D1（web 解析渲染）+ 风险表行 1 | ✅（真机验收把关） |
| 验收 2 编辑后一致 | 技术方案 3（PlanCard 编辑态）+ 契约冻结 PlanPayload 字面 | ✅ |
| 验收 3 落单原子（全成或全不建） | 技术方案 5 + 测试行「中途失败全回滚」 | ✅（落点形态见 L4） |
| 验收 4 自动流转与跨仓 | 技术方案 6 + 测试行「根任务放行/排队衔接/跨仓」 | ⚠（提取语义见 M1） |
| 验收 5 泳道跳转 | 技术方案 7（跳 `/tickets/:storyId`）；`App.tsx:25` 路由 + `TicketDetailPage.tsx:217` STORY→`StorySwimlane` 事实核验成立 | ✅（回归面，无独立断言见 L1） |
| 验收 6 多轮各自成链 | D5 局部 id 闭包 + 校验规则「跨计划引用非法」 | ✅（无断言见 L1） |
| 验收 7 无干扰（视野五规则/三档零变化） | 改动仅扩 `system` 字段；既有 `perm-config`/`config-gen` 五规则用例构成回归面 | ✅ |
| 验收 8 自验证 | 风险表行 1 明写真机全链 | ✅（验证方法，Oracle 执行） |
| 规则 1 计划块协议 | 技术方案 2（` ```atd-plan ` + JSON 字面）+ 技术方案 3（识别失败降级原样文本） | ✅ |
| 规则 2 确认门唯一建单入口 | 技术方案 3/5（validate 不建单；仅 confirm 建单） | ✅ |
| 规则 3 原子建单 | 技术方案 5 + D3 | ✅ |
| 规则 4 校验单源（仓储/worker/计划内依赖/环） | 技术方案 4 + D2 + 测试行（含越界/重复/跨计划/环/文件集形态） | ⚠（错误形态见 H2；`field` 值域未冻结） |
| 规则 5 冻结语义（spec/plannedFiles 随建单冻结；STORY 描述=概要） | 技术方案 5（`submitSpec` 逐任务）+ `description=story.description` | ✅ |
| 规则 6 事务提交后即刻放行无依赖任务 | 技术方案 6 + D3（放行在事务后） | ✅（语义见 M1） |
| 规则 7 助手行为不变 | 仅 `agents.atd-ht-{ws}.system` 增字段（`config-gen.ts:139` 现写 `{permissions}`，增量为真） | ✅ |
| 规则 8 确认后会话继续可用 | 无额外改动（会话与建单解耦） | ✅ |
| 规则 9 计划卡上限/编辑态不持久 | 技术方案 3「编辑态本地（刷新回原稿）」+ 风险表行 4 | ✅ |

**小结**：spec 侧无遗漏项（r1 的 5 项已在 spec v3 闭合，impl 逐条有落点）；下述问题**全部集中在 impl 的任务块完备性与契约/语义定型**，不在 spec 覆盖。

## 可实现性挂点核验（Oracle 指定重点）

| 挂点 | 核验结论 | 证据 |
|---|---|---|
| **confirm「单事务建单」在现有 service API 形态下可否落** | **成立（挂点真实，非假挂点）**——`createTicket:200` / `addDependency:776` / `submitSpec:432` 各自 `this.db.transaction` 是**独立事务**，但外层 `db.transaction` 包 service 调用可行：drizzle better-sqlite3 `session.js:45-57` 对嵌套事务改用 `savepoint sp{n}` / `rollback to savepoint`；better-sqlite3 `transaction.js:52-77` 以 `db.inTransaction` 判定嵌套（`before = savepoint`，`undo = rollbackTo`）。外层抛错时内层 savepoint 回滚后重抛 → 外层 `ROLLBACK` 全量回滚，「全成或全不建」语义可达成 | `ticket-service.ts:200/432/776`；`drizzle-orm/better-sqlite3/session.js:45-57`；`better-sqlite3/lib/methods/transaction.js:54-77` |
| 同一事务内后续 `createTicket(parentId=story.id)` 能否读到未提交的 STORY | 成立（同连接读未提交写；内层仅换 tx 句柄不换连接） | `ticket-service.ts:214`（读 `tx`，同 session） |
| confirm 事务后放行与 S3 排队语义衔接 | 成立——`transition(...'DISPATCHED',{actor:'system'})` 内部即含闸门/文件集判定并 `enqueue`（保持 SPEC_READY + `queued_reason`），system 通道文件冲突不报错 | `ticket-service.ts:534-552`；`dispatcher.ts:559-566` |
| `releaseChainReady` 提取的回归面 | 可提取（既有 `onTicketSettled` 结构=下游枚举 + 四前置 + 依赖全 DONE + system transition + 非 DISPATCHED 不 spawn），但**提取粒度需明确**（见 M1） | `dispatcher.ts:534-573` |
| `ConfigAgent.Info.system` 注入位 | 成立（spec r1 已核 `plugin/agent.ts:102`；本报告复核 `config-gen.ts:133-143` 现仅写 `permissions`，增量改造） | `config-gen.ts:133-143` |
| web 计划块提取挂点 | 成立——`ChatMessage.tsx:132-140` assistant markdown 渲染分支为唯一挂点；`HumanThinkPage.tsx:686-687` 为唯一调用点（可在同文件透传 props/回调） | `ChatMessage.tsx:132-140`；`HumanThinkPage.tsx:686` |
| 装配通道（runtime 引用面） | 成立——`AppRuntime` 已含 `service/dispatcher/registry/workspaces`（`app.ts:34-43`），`registerHumanThinkRoutes(app, db, runtime)`（`app.ts:92`）两条引用通道齐备；web 侧 `getWorkers`/`getWorkspace` 既有导出，无需新增 api 文件 | `app.ts:34-43/92`；`web/api/tickets.ts:172/186` |

> 结论：**无「假挂点」**；但挂点 1 的落点与同步约束未写入 impl（见 L4），且挂点 5 的装配调用点漏出文件集（见 H1）。

## 发现的问题

### high

1. **块 1 文件集漏 `apps/server/src/app.ts`（`buildServeConfig` 装配通道），且 `VisionWorkspace`/装配映射丢 repo `id` 与 `primary`，产出合同的 repoRef 取值域无来源** — 严重程度：high
   - 位置：impl:10（技术方案 1「该 workspace 的 repos 清单与全局可用 workers 清单」）、impl:27（config-gen 行「动态 repos/workers 清单注入」）、impl:31（快照单测「模板含 repos/workers 动态段」）；块 1 文件表 impl:23-31 **无 `app.ts`**
   - 代码事实：`buildServeConfig(user, workspaces)` 的唯一调用点是 `app.ts:224-227`，其入参映射为 `repos.map((r) => ({ path: r.path, role: r.role }))`——**丢掉 `id` 与 `primary`**；`VisionWorkspace.repos` 类型亦仅 `{path, role}`（`config-gen.ts:15-18`）；workers 清单（`runtime.registry.list()`）当前**完全未进**该调用链
   - 影响：①模板要写 `repoRef` 取值域（impl:10 字段说明）必须以 repo **id** 表达，现映射与类型均无 id → 按字面实现只能给出路径清单，产出合同的 repoRef 选项失真（模型可能编造 id，直接打验收 1/2 的可用性）；②注入 workers 必须扩 `buildServeConfig` 入参 → 调用点 `app.ts` 不改则 tsc 红（若写成可选参数则静默漏注入，产出合同缺 workerId 取值域）；③与 S2b1 impl r1 的 H1/H3（`web/src/App.tsx` 路由挂载、`test/helpers.ts` 装配 seam 遗漏）同类，属「装配通道真实性」复现
   - 建议：块 1 补 `apps/server/src/app.ts`｜`buildServeConfig` 入参扩 workers（或新增纯函数承载），并在 `start()` 内装配位传入 `runtime.workspaces.list()`（携 `id/primary`）与 `runtime.registry.list()`；`VisionWorkspace.repos` 类型补 `id` 与 workspace `primary`；`config-gen.test.ts` 的 `WS` fixture 同步（该文件已在表内）

2. **confirm 失败契约与既有错误信封/状态映射双重冲突：`422 + code:'VALIDATION' + details: PlanIssue[]`** — 严重程度：high
   - 位置：impl:50「校验失败 422 `{error:{code:'VALIDATION', details: issues}}` 且零建单」；impl:49（PlanIssue=`{taskId?, field, message}`）；impl:43（web 手抄义务）
   - 代码事实：①`ERROR_STATUS.VALIDATION = 400`（`domain/errors.ts:29`），**不是 422**；②统一信封 `ApiErrorBody.details?: string[]`（`routes/types.ts:20`）、`AppError.details?: string[]`（`errors.ts:60`）、web `ApiError.details?: string[]`（`web/api/tickets.ts:30`）——三处皆为 `string[]`，而 impl 冻结的是**对象数组**；③web 两条 request 通道都会对 details 调 `join('；')`（`web/api/tickets.ts:62-63`、`web/api/humanthink.ts:41-43`）→ 对象数组渲染为 `[object Object]`，`taskId/field` 定位信息在 `ApiError` 上**不可达**；④按字面走 `new AppError('VALIDATION',…,issues)` 会 TypeError（TS2345）+ 落 400，与冻结契约不符
   - 影响：块 2 按契约手抄将同时踩中「状态码错、类型错、标红定位不可用」三处；`PlanCard` 的「违规项标红至对应任务字段」（impl:39）在 confirm 回传路径上无数据源（只有 validate 的 200 通道可用）；属 S2b1 质量门同一缺陷类（web 手抄契约漂移）
   - 建议（择一定型并写进契约冻结节）：**(a) 推荐** confirm 同样返回 **200 双态** `{ok:true, story, tasks} | {ok:false, issues}`（与 validate 的 200 恒定同构，零信封改动，标红路径单一）；或 (b) 新增独立错误码（如 `PLAN_INVALID → 422`，需补 `errors.ts` 联合+映射并在块 1 列文件），`details` 保持 `string[]` 摘要、`issues` 走独立响应字段；同时**冻结 `PlanIssue.field` 值域**（如 `'title' | 'spec' | 'repoRef' | 'workerId' | 'dependsOn' | 'plannedFiles' | 'id' | ''`）并写明 `taskId` 为空=计划级问题的约定，否则 web 无法做字段级映射

### medium

3. **`releaseChainReady(storyId)` 的语义与「`onTicketSettled` 改调后行为不变」在不同候选枚举源下不自洽** — 严重程度：medium
   - 位置：impl:16（「dispatcher 将既有 `onTicketSettled` 内的『下游自动放行』核心提取为独立方法 `releaseChainReady(storyId)`……既有 `onTicketSettled` 改调提取后的方法（行为不变）」+「签名以现状为准」）、impl:61（D6「两入口共用，行为面单一」）
   - 代码事实：既有核心的**候选枚举**以触发票为轴——`blockedBy = ticketId` 的下游（`dispatcher.ts:538-542`），前置含 `parentId != null`（`:550`）；而 confirm 入口需要的候选枚举以 **STORY 为轴**（该 STORY 的子单）；两者共用的是「per-ticket 放行判据+`transition`+条件 `onDispatched`」，不是同一个枚举。若照字面把 `storyId` 入口让 `onTicketSettled` 复用（如解析 settled 票的 `parentId` 再调 `releaseChainReady(parentId)`），候选集从「本票下游」扩为「整条链全部可放行子单」——既可能重复放行并行分支（`transition` 会挡，但 `onDispatched` 时序与 `releaseAndRecheck` 交互变化），也改变了「无依赖但非本票下游」单的触发条件，「行为不变」不可证
   - 影响：回归面断言（dispatcher 既有用例）可能因候选集扩张而变红，Builder 也可能自造第二套放行语义（正是 spec r2 观测 2 明令避免的「直连 spawn 路径」）
   - 建议：技术方案 6 写死两层结构——**私有 `tryReleaseChainTicket(id)`（=`:548-567` 逐票判据与副作用，含 try/catch 隔离）+ 两个枚举入口**（`onTicketSettled(ticketId)` 枚举下游 / `releaseChainReady(storyId)` 枚举该 STORY 子单），并声明「两入口仅候选集不同，判据与副作用单一实现」；`releaseChainReady` 对非根子单走既有「依赖全 DONE」判据（空依赖即真）而非另写「无依赖」判定

### low

4. **单事务建单的落点与同步约束未写明（依赖 better-sqlite3 嵌套 savepoint；事务回调禁 async）** — 严重程度：low
   - 位置：impl:15（「`db.transaction` 内——建 STORY → 逐任务建 TASK → `addDependency` → 逐任务 `submitSpec`」）；块 1 文件表无 `ticket-service.ts`，隐含由新 `plan.ts` 持 `db` 开外层事务
   - 事实：该形态可行（见上节核验），但 `plan.ts` 的 `db` 来源、以及「service 方法自带事务、外层靠嵌套 savepoint 合并」这一非显然依赖均未记录；且事务回调必须**同步**（better-sqlite3 `transaction.js:66-68` 对返回 Promise 直接抛 `TypeError`），而 confirm 路由是 async handler，Builder 极易写成 `db.transaction(async (tx) => …)` 而失败
   - 建议：技术方案 5 补半句口径——「由 `plan.ts` 以外层 `db.transaction` 包 service 调用（依赖 better-sqlite3 嵌套 savepoint 合并为单事务）；回调内**禁 `await`**（better-sqlite3 同步铁则）」；或改为「`ticket-service` 新增编排方法承载事务」并把该文件列入块 1（二者择一写死）

5. **测试面落点缺装配前提与放行副作用旁路（含验收 5/6 无断言）** — 严重程度：low
   - 位置：impl:30（`plan.test.ts` 用例清单）
   - 事实：①`createTestContext`/`createRealContext` 默认 `humanthink:{enabled:false}`（`test/helpers.ts:103/206`），经 HTTP 打 plan 端点需显式开装配 + fake serve seam（`test/humanthink/fake-serve.ts`），而 impl 未写该前提；②`autoDispatch` 只门禁 HTTP 放行路径（`routes/tickets.ts:141`），`onTicketSettled`/候选新入口内的 `onDispatched` **无 autoDispatch 门**（`dispatcher.ts:559-566`），故「根任务 DISPATCHED」断言会真起 spawn，需在测试内 override `dispatcher.onDispatched`（public 方法）才确定；③验收 5（泳道跳转）、验收 6（多轮独立成链）无任何断言落点
   - 建议：测试行补明「humanthink 装配/fake serve 前提」「放行断言以 override `onDispatched` 隔离 spawn」；并补 2 条断言（同一会话连续两次 confirm 生成两条互不影响链；STORY 详情跳转目标 id 取自 confirm 响应）

6. **`plan` 两端点的门卫口径未声明（503 降级门卫 / 已删会话三分）** — 严重程度：low
   - 位置：impl:26（routes 行仅写路径与响应）
   - 事实：既有 humanthink 端点一律 `assertAvailable()`（serve 非 ready → 503，`routes.ts:103-107`）+ 操作类端点 `assertActive`（已删会话 422 `SESSION_TERMINATED`，`routes.ts:116-118`）；plan 的 validate/confirm 是**纯域操作**（不触 serve），是否继承 503 门卫、已删会话可否确认建单，均未定
   - 建议：routes 行补一句口径（建议：不挂 `assertAvailable`——降级期不应阻断建单；挂 `assertActive`——已删会话拒绝确认，并对应加一条用例）

7. **端点计数与注释漂移（「9 端点」→ 11）** — 严重程度：low
   - 位置：impl:26「+2 端点」；既有注释写着 9 端点：`humanthink/routes.ts:13`、`web/api/humanthink.ts:2`、`routes/types.ts:100`
   - 影响：三处注释（其中 `routes/types.ts` 属契约镜像先例区）在两块内均需同步，漏改后与仓内「注释终态化」约定不符
   - 建议：块 1/块 2 对应行各补「端点计数与头部注释同步 9→11」

## 观测（不计分，供 impl 修订/后续轮次参考）

1. **confirm STORY 的终局收口未记档**：confirm 建的 STORY 落 `DRAFT`（`createTicket` 固定），而 STORY 进入 `SPEC_READY` 只能经 `submitSpec`（`status.ts:19-20` + `ticket-service.ts:490-492` 对全类型拒绝 `to=SPEC_READY`），且父单无自动收口（`dispatcher.ts` 对下游只放行 TASK，无 STORY 汇总）。即：TASK 链可全自动，STORY 关单仍需人工 submitSpec + 逐态转移。与验收 4（只要求 TASK 自动放行）不冲突，但建议在范围/不做清单记一句，避免验收期被当缺陷。
2. **`plannedFiles` 形态校验出现双轨**：impl 在 plan 校验引入「相对路径/尾斜杠目录」形态校验，而人工路径 `specBody.plannedFiles` 仅 `min(1)`（`routes/tickets.ts:60`）。属合理加强（S3 文件集语义需要），但建议技术方案 4 注明「本校验仅 plan 入口」或后续对齐人工入口，避免同一字段两个标准。
3. **`validate` 的 200 恒定与 503 门卫的组合**：若采纳问题 6 建议（不挂 `assertAvailable`），validate 在 serve 降级期仍可预检，属正向；如不采纳需在契约行明确 503 语义，避免块 2 把 503 当校验失败渲染。
4. **块间文件集不相交性成立**：块 1=`apps/server/**`（+ `routes/types.ts` 镜像），块 2=`apps/web/**`；契约冻结节（impl:47-52）位于两块之间，满足「契约运行时与类型同块拥有」与块 2 并行依据；补 H2 后该节即可作为唯一事实源。

## 结论

# REJECT

状态：IMPL_REVIEWING → IMPL_DRAFT

> 一句话理由：spec 覆盖无遗漏、Oracle 指定的「单事务建单」挂点经 drizzle/better-sqlite3 嵌套 savepoint 实现核验**成立**（非假挂点），但块 1 漏 `app.ts` 装配通道且 repos/workers 清单的 id 来源缺失（H1），confirm 失败契约与既有信封/状态映射双重冲突且 `field` 值域未冻结（H2），`releaseChainReady` 提取粒度使「行为不变」不自洽（M1）；另 4 项 low。三项主问题均为文档级（一行~一段）修正，补齐即可复评。未修改 impl 正文与任何业务代码。
