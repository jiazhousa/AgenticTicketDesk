# 审查报告: atd-s3-parallel-retry — Impl (Revision 2)

- **类型**：Story Impl 完整审查（S-S8 第二轮，编码前最后一道）
- **审查对象**：`.specpipe/plans/atd-s3-parallel-retry/impl.md`（v2，95 行）
- **上一轮**：`atd-s3-parallel-retry-impl-review-r1.md`（REJECT 6/100：critical×1 / high×3 / medium×5 / low×4）
- **基准**：同目录 `spec.md`（v3.1，SPEC_APPROVED；验收 1-10 / 业务规则 1-10 / 偏离清单 6 条）
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（main@8456548 区间的当前工作区，只读）
- **核对方式**：逐点对照 `dispatcher.ts`（settle/preSpawnFail/resolveTicket/reopen/onTicketSettled/recoverOnStartup 全路径）、`domain/status.ts`（TRANSITIONS/isUserEdge）、`domain/ticket-service.ts`（TransitionOptions/transition/toTicket）、`domain/errors.ts`、`db/schema.ts`、`app.ts`/`index.ts`（装配面）、`routes/{tickets,types,execution}.ts`、`config.ts`、`config.yaml`、`report.ts`、`test/helpers.ts`、`test/dispatcher.test.ts`、`drizzle/{0003_s2w1_blocker_inline.sql,meta/_journal.json,meta/*}`、`web/src/{api/tickets.ts,components/{TransitionActions,DispatchForm}.tsx,pages/{WorkbenchPage,TicketDetailPage}.tsx}`
- **状态校验**：`.stage` = `IMPL_REVIEWING` ✓（与派发口径一致）
- **日期**：2026-09-25

## 总体评价

**不通过**——r1 的机制性缺陷已基本闭合：**新建** `onInflightReleased` 回调通道（D2 明确改口径「现状不存在、本 Story 新建」）、`app.ts`/`index.ts` 入块 1、settle 超时/崩溃 FAILED 与 `preSpawnFail→CANCELLED` 四类路径有了挂载点、D7 弃 `channel` 改复用 `actor`（载体经代码实证成立）、D8 把校验作用域收敛到 `SPEC_READY→DISPATCHED`、排队即早绑定 `worker_id`、`planned_files` JSON 往返落点、同态升级机制、D4 步骤判据化——方向与落点均正确，且 D4 描述经复核属实（journal idx=3 有 entry、`meta/` 止于 0002；`0003` 的 DDL 仅 `ALTER TABLE tickets ADD COLUMN block_reason` 一条，其余为 DELETE 数据清理）。

但 **acceptance 4 的第四路径「卡点 BLOCKED」仍无任何挂载**，且 v2 自己的测试计划把这第四路径替换成了「前单 DONE」（测试与验收不自洽，会产出假绿）：`dispatcher.ts:270-294` 的 `IN_PROGRESS→BLOCKED`（worker 报告 blocked）既不产生 DONE 也不被列出的五处直调覆盖，而 service 回调口径被限定为「user 边」，不含该 system 边；规则 2 的闸门计数集不含 BLOCKED，故入 BLOCKED 即释放一个闸门位，必须唤醒。另有 4 处 medium（回调触发谓词自相矛盾且 abort 被误标为 user 边/事务边界未写死；排队与唤醒路径的校验顺序与通道未写死；测试 seam 注入通路未贯通；块 2 缺 `TransitionActions.tsx` + `plannedFiles` 录入入口决策未声明）与 4 处 low。问题仍全部是文档层修订，可在小时级收敛。

## 质量评分

**47 / 100**（critical ×1 = −25 / medium ×4 = −20 / low ×4 = −8）

> 分值由「acceptance 4 明列路径仍无设计落点」这一 critical 主导；其余扣分对应 r1 未完全收尾项，均为文档层。

## r1 → v2 逐项闭合核验

| r1 # | 级别 | r1 问题 | v2 处置（含代码核对） | 判定 |
|---|---|---|---|---|
| 1 | critical | 唤醒挂载集不全 + D2 所称装配通道不存在 + `app.ts`/`index.ts` 未入清单 | 技术方案 4 重写：**新建** `onInflightReleased`（service 构造期声明 + app.ts 后置接线）、dispatcher 五处直调、启动扫描；D2 改写为「现状无此通道」；`app.ts`/`index.ts` 入块 1 | **部分闭合**——通道与清单已闭合；`settle` 报告 blocked（卡点 BLOCKED）路径仍无挂载，见 C1 |
| 2 | high | 排队单 worker 绑定丢失 | 技术方案 1 + 改动点③：排队即 `update worker_id` 早绑定（复用既有列） | **已闭合**（机制），通道/校验顺序口径残留见 M2 |
| 3 | high | 闸门/冲突校验波及 reopen 与 resolveTicket | 技术方案 2 + D8：仅 `SPEC_READY→DISPATCHED`；reopen/resolve 直执行，R4 记档接受瞬时超闸 | **已闭合** |
| 4 | high | `channel` 与 `actor` 双写；`autoDispatch` 引用不成立 | D7：删 `channel`，复用既有 `actor` 判定通道 | **已闭合**——载体经实证：`ticket-service.ts:78-90`（`actor?: 'user'\|'system'`，`:422` 缺省 user）、`routes/tickets.ts:133` 显式 `'user'`、`dispatcher.ts:438-441` 自动放行显式 `'system'`、`repoRef` 复校仅 user 分支（`ticket-service.ts:450`）。残留「abort = user 边」误标见 M1 |
| 5 | medium | `helpers.ts` 入清单 / tick seam / 退避断言可构造 | `helpers.ts` 入块 1；D3 给 `tickIntervalMs`/`now()` seam | **部分闭合**——注入通路与 config opts 未写，见 M3 |
| 6 | medium | `planned_files`(TEXT)→`plannedFiles: string[]` 转换无落点 | 改动点②：写侧 `JSON.stringify`、读侧 detail/list mapper `JSON.parse` 还原；⑦ 透出含反序列化 | **已闭合** |
| 7 | medium | retry 上限升级（同态更新）机制未声明 | 技术方案 5 + ④：字段级更新 `pending_label`→`'l3'` + `blockReason` 摘要 + system comment，**不写 transitions 行**（审计载体=comment） | **已闭合** |
| 8 | medium | `startRound` 立即重试循环改造未列 | 改动点②：移除立即 `bumpRound`+respawn，改 RETRY_WAIT 流程 | **部分闭合**——语义已写死，结构改造/签名影响未列，见 L1 |
| 9 | medium | 块 2 缺 `TransitionActions.tsx`；`plannedFiles` 录入入口未定 | 未处置（块 2 仍为 types/tickets/QueuedTag/Workbench/List/Detail 六项） | **未闭合**，见 M4 |
| 10 | medium | D4 缺可执行步骤与判据 | D4 四步（首跑预期 → 手补 0003 snapshot → 重跑判据「0004 仅含 S3 变更」→ migrate+测试判据）+ fallback | **已闭合**——现状复核属实（`_journal.json` idx=3 有 entry、`meta/` 止于 `0002_snapshot.json`；`0003_*.sql` = `ALTER TABLE tickets ADD COLUMN block_reason` + 6 条 DELETE 数据清理，与 D4 描述一致） |
| 11 | low | `report.ts`「同源 execGit 通道」表述不实 | 未修正（impl:40 仍写「同源 execGit 通道」） | **未闭合**，见 L3 |
| 12 | low | 验收 9「契约不变」与「Ticket 增 5 字段」措辞未对齐 | 未补 | **未闭合**，见 L4 |
| 13 | low | `api.test.ts` 与新增 `api-s3.test.ts` 二选一未定 | 未定（仍写「或新增 api-s3.test.ts」） | **未闭合**，见 L4 |

## 发现的问题

### critical

1. **唤醒触发面仍漏「settle 报告 blocked（卡点 BLOCKED）」路径；且测试计划以「前单 DONE」替换了 acceptance 4 的第四路径，测试与验收不自洽** — 严重程度：critical
   - 位置：impl 技术方案 4（“五处内部直调”清单）、改动点 `dispatcher.ts` ①、测试行「饥饿免疫四路径」；对照 `dispatcher.ts:270-294`（报告 blocked → `IN_PROGRESS→BLOCKED`，`pendingLabel` 缺省 'l3'）、`:296-307`（报告缺失/升级）、`:311-333`（preSpawnFail）、`:451-481`（recoverOnStartup）；spec 验收 4、规则 2、规则 5
   - 描述：
     ① **挂载集仍不全**：v2 列出的五处为「settle DONE / settle FAILED（超时）/ settle FAILED（崩溃）/ preSpawnFail→CANCELLED / RETRY_WAIT 入 BLOCKED」。`dispatcher.ts:282` 的**报告 blocked → `IN_PROGRESS→BLOCKED`**（即验收 4 的「卡点 BLOCKED」、规则 5 的「入 BLOCKED」）不产生 DONE 也不是 RETRY_WAIT，**无任何挂载**；service 回调口径被限定为「user 边成功路径」，而该转移是 `actor:'system'`（`:283`），同样不覆盖。按规则 2，闸门计数集 = DISPATCHED+IN_PROGRESS（不含 BLOCKED）——入 BLOCKED 即释放一个闸门位，必然要求唤醒排队单。同类未列项还有 `preSpawnFail` 的 `IN_PROGRESS→FAILED`（`:323`），与规则 5「**任何**离开 {DISPATCHED, IN_PROGRESS} 的转移」字面不符。实际挂载点应为 7 处（DONE + FAILED×3 + BLOCKED×2 + CANCELLED），impl 写「五处」。
     ② **测试计划与验收 4 冲突**：验收 4 明列四路径 =「超时 FAILED / 崩溃 FAILED / preSpawnFail CANCELLED / **卡点 BLOCKED**」；impl 的用例集却写「前单 **DONE**/超时 FAILED/崩溃 FAILED/preSpawnFail CANCELLED 各起一排队单……对应四挂载点」——用不在验收 4 之列的 DONE 替换了正是缺挂载的「卡点 BLOCKED」。设计缺口与测试缺口同源，会产出「实现+用例全绿而验收 4 不达标」的假绿。
   - 影响：卡点单（worker 报告 blocked）之前的排队单永久挂起，正是验收 4 要防的饥饿场景；规则 5 的单入口收敛承诺不成立。
   - 建议：① 挂载清单补 settle 报告 blocked 分支（`:282` 转移成功后调 `releaseAndRecheck`）；更彻底的做法是把触发谓词收敛到 `service.transition` 单一咽喉（见 M1），dispatcher 直调退化为冗余；② 测试行把「前单 DONE」改回「卡点 BLOCKED（worker 报告 blocked → BLOCKED）」，DONE 可作为附加行；③ 顺手把 `preSpawnFail` 的 `IN_PROGRESS→FAILED` 纳入同一谓词。

### medium

2. **回调契约未写死：触发谓词与枚举自相矛盾（`abort→FAILED` 经实证不是 user 边）、事务边界缺失、签名不一致** — 严重程度：medium
   - 位置：技术方案 4 第二类挂载、D2、改动点 `ticket-service.ts` ①⑤；对照 `status.ts:41-57`、`dispatcher.ts:361`、`app.ts:93-108`
   - 描述：
     ① 谓词写「所有离开 {DISPATCHED, IN_PROGRESS} 的 **user 边**成功路径」，枚举却是 `DISPATCHED→CANCELLED`、`BLOCKED→CANCELLED`、`BLOCKED→FAILED（abort 裁决）`——后两条**离开的是 BLOCKED** 而非执行态；且 `isUserEdge` 对 TASK 的白名单（`status.ts:43-54`）含 `DISPATCHED→CANCELLED`（:48）、`BLOCKED→CANCELLED`（:49），**不含 `BLOCKED→FAILED`**；`dispatcher.ts:361` 的 abort 实际传 `actor:'system'`。若 Builder 按 `actor==='user'` 过滤，abort 释放不触发（impl 自己的用例「abort→FAILED 三边」将失败或被迫迁就）。
     ② 事务边界未写：r1-c1-③ 要求「写明回调签名与事务边界（建议事务提交后回调）」，v2 只给签名。若回调落在 `db.transaction` 内，`releaseAndRecheck → service.transition → spawn` 会在未提交事务内同步执行（同态重入 + 事务内长耗时）。
     ③ 签名不一致：技术方案 4/改动点①写 `releaseAndRecheck()`（无参），`app.ts` 行却写 `(id) => dispatcher.releaseAndRecheck(id)`。
     ④ D2 同段既写「TicketService **构造注入** `onInflightReleased`」又写「app.ts 装配时接线 `service.onInflightReleased = …`」——`app.ts:93-97` 先建 service、`:99-108` 才建 dispatcher，构造期该回调不可能存在，只能是后置绑定/可变字段。
   - 影响：Builder 可能按 actor 过滤（漏 abort）或把回调置于事务内（重入/长事务）；「构造注入」措辞会诱导不可实现的写法。
   - 建议：写死三件事——「触发条件：`service.transition` 事务**提交成功后**，`from ∈ {DISPATCHED, IN_PROGRESS}`（任一 actor）**或** `from='BLOCKED' 且 to ∈ {CANCELLED, FAILED}`」；「绑定形态=后置赋值/setter（非构造参数）」；「签名 `releaseAndRecheck(ticketId?: number)`，参数仅作触发来源标记，函数体对全部排队单按 `queued_at` FIFO 重校验」。

3. **排队与唤醒路径的通道语义、校验顺序未写死（早绑定 worker_id 与四件套的先后、唤醒 actor、repoRef/worktree 复校、tick 内 422 传播）** — 严重程度：medium
   - 位置：技术方案 4/1、改动点 `ticket-service.ts` ③、`dispatcher.ts` ①；对照 `ticket-service.ts:450-468`（四件套：workerId 必填/∈Registry/repoRef 复校/worktree，仅 user 通道）
   - 描述：
     ① `③` 写「闸门满 → 先 `update worker_id`（请求携带则更新）+ 落 queued 两字段 → 返回」，未声明四件套校验的先后。若先落 `worker_id` 再校验，未注册的 workerId 会被持久化，而唤醒链要求 `workerId∈Registry` → 该单永久排队、用户再也拿不到既有的 `WORKER_UNKNOWN(422)`（静默饥饿，与 r1-h1 的修复方向相反的效果）。
     ② ① 唤醒链写「重走完整放行前置链（闸门+文件集+`workerId∈Registry`）」，未含 `repoRef` 复校与 worktree 前置，也未写重放转移用哪个 actor。用 system 通道 → 绕过 `repoRef` 复校（漂移时静默走 `preSpawnFail→CANCELLED`，人工排队单与编排链单语义混同）；用 user 通道 → 四件套抛出的 422（`REPO_REF_DRIFTED`/`MANUAL_FORBIDDEN`/`WORKTREE_SETUP`）会落在 5s tick 内，impl 未写捕获/隔离方式。
   - 影响：静默永久排队、或漂移/异常时整轮 tick 中断（影响其他到期单），Builder 只能自行拍板。
   - 建议：一行写死「四件套（含 Registry/repoRef/worktree）先于闸门/文件集双校验执行，失败照旧 422；通过后闸门满才落 `worker_id`+queued」+「唤醒重放用 system 通道且显式复校 repoRef，漂移/校验失败 → 保持排队并落 system 留言，不 CANCELLED」+「tick 对每单 try/catch 隔离」。

4. **测试 seam 注入通路未贯通：`helpers.ts` 无配置注入 opts、`RuntimeOptions` 未扩 tick/now** — 严重程度：medium
   - 位置：块 1 `test/helpers.ts` 行、D3、改动点 `dispatcher.ts` ③、`app.ts` 行；对照 `helpers.ts:73-77`（`createTestContext` 内联 `AppConfig` 字面量）、`:132-185`（`createRealContext` opts 无并发/退避项；config 字面量 `:164-168`）、`app.ts:29-40`（`RuntimeOptions` 无 tick/now）
   - 描述：acceptance 3 需 `maxConcurrentPerRepo=1`，acceptance 5 需可控 `retryBackoffSec`/`maxRetries` 与确定性 tick 驱动；但 impl 的 helpers 行只写「fake worker/上下文工厂扩双并行 spawn 支持」，未列配置 opts；D3 的 `tickIntervalMs`/`now()` 是 `DispatcherDeps` 字段，测试经 `buildServer`（`RuntimeOptions`）无法注入。r1-m5 三项（helpers 入清单 ✓、tick seam ✗ 通路、退避相对断言 ✗ 落点）仅一项闭合。
   - 影响：块 1 自验按 impl 字面写不出 acceptance 3/5 的用例，Builder 需自行发明注入面。
   - 建议：`helpers.ts` 行明列新增 opts（`maxConcurrentPerRepo`/`maxRetries`/`retryBackoffSec`/`tickIntervalMs`/`now`），并同步把 `RuntimeOptions` 扩入 `app.ts` 行；退避断言写成「注入 now + 小退避基数 → 断言相对序列与封顶 240 换算」。

5. **块 2 文件集仍缺 `TransitionActions.tsx`（放行按钮实际渲染点、详情页复用）；`plannedFiles` 前端录入入口决策未声明** — 严重程度：medium
   - 位置：块 2 清单；对照 `web/src/components/TransitionActions.tsx:62-126`（TASK `SPEC_READY` 渲染「放行派发」→ `DispatchForm`）、`pages/TicketDetailPage.tsx:150`（使用 `TransitionActions`）、`pages/WorkbenchPage.tsx:199-225`（待处理区自行渲染放行按钮）
   - 描述：① `TransitionActions` 是 SPEC_READY 放行按钮的共享渲染点（详情页经它渲染），块 2 只在 `WorkbenchPage` 写「排队单隐藏放行按钮」，详情页将仍显示放行按钮并可重复触发排队（规则 3 的 UI 口径在详情页缺失）；该文件亦未列入清单（r1-m9 明确要求）。② spec 范围写「submitSpec 请求体扩为 `{specContent, plannedFiles?}`」，但 impl 未定义前端录入入口（哪个组件收集、随 spec 提交），也未显式记「首版不做 UI 录入」的决策——若不做，`plannedFiles` 在 UI 侧空转（仅 API/编排链可用）。
   - 影响：Builder 自行发明录入面或漏改共享组件；验收 8 的「排队徽标」在详情页不一致。
   - 建议：块 2 补 `TransitionActions.tsx`（排队态隐藏放行按钮，或把「queuedReason 非空 → 隐藏放行」收进共享组件）；`WorkbenchPage`/`TransitionActions` 行写明 `plannedFiles` 入口决策（做：并入提交 spec 弹层，每行一路径；不做：显式标注理由供用户确认）。

### low

6. **「移除立即重试」只写语义未列结构改造（`startRound` while / `runOnce` 返回值 / `settle` 签名）** — 严重程度：low
   - 位置：改动点 `dispatcher.ts` ②；对照 `dispatcher.ts:67-72`（`while (retry) retry = await this.runOnce()`）、`:74-75`（返回 true=立即重试）、`:296-298`。
   - 建议：② 补一句「移除 `startRound` 的 while 与 `runOnce` 的 boolean 返回（或恒返回 false），重试闭环移交 tick；`settle` 返回值/RoundResult 影响一并注明」。

7. **升级判定时点二义（进入 RETRY_WAIT 时 vs 到期 tick 时），影响 240 档是否被观察** — 严重程度：low
   - 位置：D6 与改动点 ④；对照 spec 验收 5/规则 6。
   - 描述：④ 写「tick 内 `retry_count≥maxRetries` 走同态升级」，D6 写「默认 3 → 60/120/240 三次后升级」；若 Builder 落在「进入 RETRY_WAIT 时判定」，`count=3` 立即升级 → 240 档不会出现、实际重试次数与「60/120/240」的用例断言不符。
   - 建议：写死「到期 tick 时判定：count=1/2/3 分别等待 60/120/240；第三次到期直接升级（不再 spawn）」。

8. **`report.ts` 行「同源 `execGit` 通道」表述仍不实** — 严重程度：low
   - 位置：impl:40；对照 `report.ts:44-48`（内联 `execFileSync('git', ['-C', wt, 'log', '--format=%H', `${baseline}..HEAD`])`，仓内无 `execGit` 助手）。
   - 建议：改为「与 `listNewCommits` 同一 `execFileSync('git', …)` 形态；`baseline` 取 `worktree.baseline`（merge-base），`headSha` 取 `'HEAD'`，rename 取显示路径」。

9. **`routes/types.ts` 行的 `SubmitSpecBody` 不存在；`api.test.ts`「或」未定；验收 9 兼容增量措辞未补** — 严重程度：low
   - 位置：块 1 `routes/types.ts` 行、`api.test.ts` 行、验收 9 映射；对照 `routes/types.ts:15-16`（纯 re-export，无 `SubmitSpecBody`）、`routes/tickets.ts:57`（`specBody` 为局部 zod）、`test/api-s2a.test.ts`（新文件命名先例）。
   - 描述：5 个新字段实际落在 `ticket-service.ts` 的 `Ticket` 域类型与 `toTicket`（impl ⑦ 已覆盖），`routes/types.ts` 增量表述指向不存在的类型名；测试文件名仍未定；验收 9 未补「新增 5 字段为向后兼容增量（前端 tolerant），存量路径行为断言不变」。
   - 建议：`routes/types.ts` 行改指 `routes/tickets.ts` 的 `specBody`；测试文件定为 `apps/server/test/api-s3.test.ts`；验收 9 补兼容增量说明。

## spec→impl 覆盖核对（关键行，其余与 r1 一致）

| 基准项 | impl 落点 | 判定 |
|---|---|---|
| 验收 4 饥饿免疫四路径 | 技术方案 4 五处直调 + 测试行「前单 DONE/超时/崩溃/preSpawnFail」 | ❌ 卡点 BLOCKED 无挂载且测试被替换（C1） |
| 规则 5 唤醒触发面 | 同上（service 回调限 user 边） | ❌（同 C1；「实现挂载点 onTicketSettled 扩展」被替换为新通道，未在风险表记口径映射） |
| 验收 3 闸门限流 FIFO | ① + worker_id 早绑定 | ⚠ 机制闭合，测试构造依赖 M3 |
| 验收 5 重试自愈 | 技术方案 5 + D6 + ④ | ✅（升级时点二义见 L2） |
| 验收 9 回归口径 | D7/D8 + 风险表「既有调用零语义变化」 | ✅（措辞见 L4） |
| 规则 3 排队生命周期 | ① 唤醒 FIFO + ⑤ 清空时机 | ⚠ 校验顺序/通道口径见 M3-③（本报告 M2） |
| 规则 6 RETRY_WAIT 引擎 | ②④⑤ + `pendingLabel` 参数化 | ✅ |
| 规则 9/10 契约与 UI | 契约冻结节 + 块 2 | ⚠ 文件集不全（M4） |
| 验收 1/2/6/7/8/10 | 与 r1 同 | ✅ |

## 技术决策速评（D1-D8）

| 决策 | 判定 | 说明 |
|---|---|---|
| D1 排队承载=独立列 + 早绑定 | ✅ | 与规则 3/偏离 2 一致；queue≠blockReason 语义分离 |
| D2 回调通道为新建 | ⚠ | 方向正确（现状确无通道，`onTicketSettled` 仅 DONE 调用：`dispatcher.ts:267`）；「构造注入」与「后置赋值」矛盾 + 事务边界未写死（M1-②④） |
| D3 tick=setInterval + opts seam | ⚠ | seam 声明正确；经 `RuntimeOptions` 的注入通路未列（M3） |
| D4 snapshot 修复步骤判据化 | ✅ | 现状复核属实（journal idx=3 / meta 止于 0002；0003 DDL 仅加列），四步 + fallback 可执行 |
| D5 `retryOnReportMiss` 兼容 | ✅ | optional 读取位 + warn；config.yaml 删键 |
| D6 退避口径 | ✅ | `min(base×2^(count−1),240)`、首次数=1、升级 `count≥maxRetries`；升级时点见 L2 |
| D7 复用 `actor` 判通道 | ✅ | 载体经代码实证（见 r1#4 行）；「既有自动放行链显式标 system」与 `dispatcher.ts:438` 一致 |
| D8 校验作用域收敛 | ✅ | 仅 `SPEC_READY→DISPATCHED`；R4 记档瞬时超闸 |

## 观测（不计分）

1. **附加复审点·reopen 闸门计数**：`gateCount` 为 DB 实时查询（status ∈ {DISPATCHED, IN_PROGRESS}），reopen（`dispatcher.ts:399`）落 DISPATCHED 后天然被计数 +1，`releaseAndRecheck` 每轮重查 → 不存在缓存漂移，绕闸后计数正确。
2. **附加复审点·abort 回调层级**：`resolveTicket` 是 `Dispatcher` 方法（`dispatcher.ts:339-375`）而实际转移调 `service.transition`（`:361`），故回调置于 service 层即天然覆盖 abort——`routes/execution.ts` 无需改动，块 1 在此维度完备（谓词误标问题见 M1）。
3. **附加复审点·BLOCKED→CANCELLED 确为 user 边**：`status.ts:49` ✓；`BLOCKED→FAILED` 不是（见 M1）。
4. **规则 5 触发面不含 SPEC_READY 出边**：排队单（SPEC_READY+queued）被取消可释放其占用声明，理论上能解锁与之相交的另一 FILE_CONFLICT 排队单，但无任何触发点（spec 层口径，impl 忠实）；建议 spec 后续复评是否补「排队单取消/声明变更也触发」。
5. **B6 现状与更新行对应**：`dispatcher.test.ts:262-284`（`retryOnReportMiss:1`、断言 `round=2`/`pendingLabel='l3'`/raw 路径）存在，新语义下需整体改写，impl 已列「B6 更新」。
6. **契约冻结与 spec 规则 8/9 逐字段一致**：`FILE_SET_CONFLICT`(422)、`queuedReason: 'GATE_QUEUED'|'FILE_CONFLICT'|null`、`queuedAt/retryCount/retryAt/plannedFiles`、`SubmitSpecBody {specContent, plannedFiles?}` 与 spec 规则 8/9 及范围一致；`errors.ts:2-43` 为封闭 union + 全量 `ERROR_STATUS`，新增码须两处同步（tsc 强制），impl 已列。
7. **规则 2 两集合口径**：impl 技术方案 3 与 spec 规则 2 逐字对齐（闸门集不含 BLOCKED；占用集含排队中与 BLOCKED）。

## 结论

# REJECT

状态：IMPL_REVIEWING → IMPL_DRAFT

一句话理由：r1 的机制性缺陷（装配通道不存在、`app.ts`/`index.ts` 缺清单、超时/崩溃/preSpawnFail 无挂载、`channel` 双写、作用域波及 reopen/reassign、JSON 转换/升级机制/D4 步骤）已基本闭合且方向正确，但 **acceptance 4 第四路径「卡点 BLOCKED」（`dispatcher.ts:270-294`）仍无任何挂载，且 v2 测试计划把它换成了「前单 DONE」**——仍需一轮修订（补挂载点 + 改测试行 + 写死回调谓词/事务边界、排队唤醒的校验顺序与通道、测试 seam 注入通路、块 2 的 `TransitionActions.tsx` 与 `plannedFiles` 录入决策）；4 处 low 可顺手对齐。
