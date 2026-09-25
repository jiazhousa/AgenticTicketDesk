# 审查报告: atd-s3-parallel-retry — Impl (Revision 1)

- **类型**：Story Impl 完整审查（S-S8，编码前最后一道）
- **审查对象**：`.specpipe/plans/atd-s3-parallel-retry/impl.md`（v1，85 行）
- **基准**：同目录 `spec.md`（v3.1，SPEC_APPROVED，验收 1-10 / 业务规则 1-10 / 偏离清单 6 条）；Epic `agentic-ticket-desk` §4.2/§9
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（main@8456548 区间的当前工作区，只读）
- **核对方式**：逐点对照 `dispatcher.ts`、`domain/ticket-service.ts`、`domain/status.ts`、`domain/errors.ts`、`db/schema.ts`、`drizzle/{0003_s2w1_blocker_inline.sql,meta/_journal.json,meta/*}`、`config.ts`、`config.yaml`、`report.ts`、`routes/{tickets,types}.ts`、`app.ts`、`index.ts`、`test/helpers.ts`、`test/dispatcher.test.ts`、`web/src/{api/types.ts,api/tickets.ts,pages/{WorkbenchPage,TicketListPage,TicketDetailPage}.tsx,components/BlockedResolutionCard.tsx,utils/hooks.ts}`
- **状态校验**：`.stage` = `IMPL_REVIEWING` ✓（与派发口径一致）
- **日期**：2026-09-25

## 总体评价

**不通过**——骨架成立：排队不走状态机（独立列 + SPEC_READY 承载）、双集合口径（闸门集/占用集）与 spec 规则 2 逐字对齐、`releaseAndRecheck` 单入口收敛方向正确、RETRY_WAIT 走既有 `IN_PROGRESS→BLOCKED / BLOCKED→DISPATCHED` 零新增边（`status.ts:26-27` 已实证存在）、实测防线同源 `git diff`、错误码与契约冻结字段形态与 spec 规则 8/9 一致、UI 三区分区锚点真实（`WorkbenchPage.tsx:138/199`、`utils/hooks.ts:25` `useNow`、`BlockedResolutionCard.tsx`）、块 1/块 2 文件集不相交、D6 退避口径与验收 4 的 60/120/240 自洽。

但有 **1 处 acceptance-critical 的机制落点缺口**：`releaseAndRecheck` 声明的三处挂载无法覆盖验收 4 明列的四种「离开执行态」路径，其中**超时 FAILED / 崩溃 FAILED / preSpawnFail CANCELLED 三类无任何挂载**；且 D2 声称的「AppRuntime 既有装配通道（onTicketSettled 同款）」经代码核对**不存在**——`onTicketSettled` 是 Dispatcher 内部方法且仅在 settle 的 DONE 分支被调用一次（`dispatcher.ts:267`），`TicketService` 与 `Dispatcher` 之间目前没有任何回调通道（`app.ts:93-108` 装配面与服务构造函数均无），该装配面必须**新建**，而 `app.ts`/`index.ts` 均未进块 1 清单。

另有 3 处 high（排队单 worker 绑定无持久化、闸门/冲突校验对 reopen 与 resolveTicket 的行为未定义、`channel` 与既有 `actor` 双写且 `autoDispatch` 引用不成立）、5 处 medium（测试基建与 helpers.ts 缺口、`planned_files`→`plannedFiles` 转换无落点、retry 上限升级同态更新机制未声明、`startRound` 立即重试循环改造未列、D4 探针缺可执行步骤）、4 处 low。均为文档层修订，可小时级收敛。

## 质量评分

**6 / 100**（critical ×1 = −25 / high ×3 = −36 / medium ×5 = −25 / low ×4 = −8）

> 分值低由「验收 4 明列路径无设计落点」这一 critical 主导，与文档其余质量无关（覆盖核对表 10 条验收中 8 条有落点）；问题均为文档级（无需推翻骨架）。

## 逐维度结论

| # | 评审维度 | 结论 | 要点 |
|---|---|---|---|
| 1 | spec 覆盖完备性 | 部分通过（1 critical + 1 medium） | 验收 1/2/3/5/6/7/8/10 有落点；**验收 4 与规则 5** 的唤醒挂载集不全（问题 1）；验收 9「存量路径行为不变」与 reopen/resolve 的新闸门行为冲突（问题 3）；规则 1 的 `plannedFiles` 前端/转换落点不闭环（问题 6/9） |
| 2 | 文件集完备性与不相交 | 不通过（清单不全，方向正确） | 块 1/块 2 无交叠 ✓；契约源 `routes/types.ts` 归块 1（与运行时同块拥有）✓；但 server 块漏 `app.ts`、`index.ts`、`test/helpers.ts`（问题 1/5），web 块漏 `TransitionActions.tsx`（问题 9） |
| 3 | 可实现性（对照真实代码） | 部分通过（1 critical + 3 high） | D2 装配通道不存在（问题 1）；排队 workerId 丢失（问题 2）；reopen/resolve 入队语义未定义（问题 3）；`channel` 双写（问题 4）；D4 snapshot 现状属实（journal idx=3 有 entry 而 `meta/` 止于 0002）但修复步骤不可执行（问题 8） |
| 4 | 契约冻结完备性 | 部分通过（1 medium） | 字段/错误码/details 形态与规则 8/9 一致，web 手抄义务已列 ✓；`planned_files`（TEXT）→ `plannedFiles: string[]` 的转换归属未冻结（问题 6）；web 侧 `UpdateTicketRequest` 是否含 plannedFiles 未定 |
| 5 | 技术决策自洽（D1-D7） | 部分通过 | D1/D3/D5/D6 自洽；D2 事实前提不成立（问题 1）；D7 与风险表自相矛盾且与实现事实不符（问题 4）；D4 缺可执行步骤（问题 8） |

## spec→impl 覆盖核对

| 基准项 | impl 落点 | 判定 |
|---|---|---|
| 验收 1 并行隔离 | 块1 测试「两单并行真跑互不干扰（双 fake worker 断言 worktree/分支/commit 隔离）」+ 闸门缺省 2 | ✅（依赖 helpers 注入位，见问题 5） |
| 验收 2 声明相交拒绝 | 改动点②+③、冻结 FILE_SET_CONFLICT、system 通道排队（D7） | ⚠ 通道归类未定（问题 4） |
| 验收 3 闸门限流 FIFO | 改动点②⑤ + releaseAndRecheck | ❌ 排队单 workerId 丢失 → 恢复不可执行（问题 2） |
| 验收 4 饥饿免疫四路径 | 改动点①（挂载：onTicketSettled 尾部 + BLOCKED 回调 + 启动扫描） | ❌ 超时/崩溃 FAILED 与 preSpawnFail CANCELLED 无挂载（问题 1） |
| 验收 5 重试自愈 | 技术方案 4 + D6 + B6 用例更新（`dispatcher.test.ts:262` 真实存在） | ⚠ 退避断言不可构造（问题 5）；升级机制未声明（问题 7） |
| 验收 6 实测预警 | 改动点④ + `report.ts` `extractTouchedFiles` | ✅ |
| 验收 7 重启恢复 | 改动点⑤ `recoverOnStartup` 扩 | ✅（启动扫描调用点 `index.ts:27` 已在，但挂载回归问题 1/5） |
| 验收 8 UI 分区 | 块 2：WorkbenchPage 双区 + QueuedTag + l3/agent 分流 + 列表徽标 | ✅ |
| 验收 9 回归口径 | B6 更新 + 风险表「既有调用零改动」 | ❌ reopen/resolve 新行为未声明（问题 3）；`Ticket` 增 5 字段的兼容口径未说明（问题 12） |
| 验收 10 Epic 三条 | 由 1/5/3 覆盖 | ✅（1/3 的保留同上） |
| 规则 1 plannedFiles 语义 | `file-set.ts` 单一实现 + 边界单测 | ✅ 语义；⚠ 契约转换（问题 6）、前端入口（问题 9） |
| 规则 2 两个集合 | 改动点⑤ gateCount/occupancySet | ✅ |
| 规则 3 排队生命周期 | 改动点②+③ + releaseAndRecheck FIFO | ⚠ 清空时机已写；恢复链路（问题 2）、非 SPEC_READY 来源（问题 3）不闭环 |
| 规则 4 排队不计入 retryCount | D6 口径 | ✅（隐含） |
| 规则 5 唤醒触发面 | 改动点① | ❌（同验收 4，问题 1） |
| 规则 6 RETRY_WAIT 引擎 | 技术方案 4 + 改动点②`pendingLabel` 参数化 | ⚠ 升级（留 BLOCKED 改 label）机制未声明（问题 7） |
| 规则 7 实测清单口径 | 改动点④ + `report.ts` 行（含 rename 显示路径） | ✅（表述瑕疵见问题 10） |
| 规则 8 错误码 | `errors.ts` +`FILE_SET_CONFLICT`(422) | ✅ |
| 规则 9 API 透出 | `routes/types.ts` 5 字段 + 块 2 手抄 | ✅ |
| 规则 10 web 契约与 UI | 块 2 清单 | ⚠ 文件集不全（问题 9） |

## 技术决策速评

| 决策 | 判定 | 说明 |
|---|---|---|
| D1 排队承载=独立列 | ✅ | 与 spec 规则 3/偏离 2 一致，queue≠blockReason 语义分离成立 |
| D2 唤醒挂载（service 层 BLOCKED 回调经「既有装配通道」） | ❌ | 前提事实错误：无该通道（问题 1）；且只覆盖 BLOCKED 一类，漏 FAILED/CANCELLED；回调置于 `transition` 事务内会引入同态重入（releaseAndRecheck→transition）时序未讨论 |
| D3 tick=dispatcher 内 setInterval(5s)，AppRuntime 挂载/清除 | ⚠ | 方向可行；但 `app.ts`/`index.ts` 未入清单，且未写 unref/onClose 清理与测试 seam（问题 1/5） |
| D4 drizzle snapshot 修复 | ⚠ | 现状核对属实（`meta/` 止于 0002，journal idx=3 有 0003 entry）；缺可执行步骤与确定性验收（「两小时内」非可验证判据）——问题 8 |
| D5 retryOnReportMiss 兼容 | ✅ | optional 保留 + warn 可行（`helpers.ts:76/137/167`、`dispatcher.test.ts:266` 仍传该键，类型兼容；`dispatcher.ts:297/300` 为唯一读取点） |
| D6 退避口径 | ✅ | `min(backoff×2^(retry_count−1), 240)`，count 首次=1 → 60/120/240；升级 `count>=3` → 与验收 5「连续失败按 60/120/240 退避，达 maxRetries 升级」一致 |
| D7 channel 区分 | ❌ | 与既有 `actor`（`ticket-service.ts:80`，值域同为 `'user'\|'system'`）双写；「既有自动放行链调用点显式传 'system'」（`dispatcher.ts:438-441` 已传 `actor:'system'`）与风险表「既有调用零改动」自相矛盾；「经既有 autoDispatch 标志区分」不成立（`TicketService` 无该标志，见问题 4） |

## 发现的问题

### critical

1. **唤醒单入口 `releaseAndRecheck` 的挂载集不满足验收 4 / 规则 5，且 D2 所称装配通道不存在、`app.ts`/`index.ts` 未入块 1 清单** — 严重程度：critical
   - 位置：impl 技术方案 3、改动点 `dispatcher.ts` ①、D2；对照 `dispatcher.ts:210-308`（settle）、`:311-333`（preSpawnFail）、`:413-449`（onTicketSettled）、`:451-481`（recoverOnStartup）、`app.ts:93-108`（装配）、`index.ts:27`
   - 描述：
     ① **挂载集不全**：impl 声明的三处挂载（`onTicketSettled` 尾部 + service 层 BLOCKED 回调 + 启动扫描）只能覆盖「DONE」（`dispatcher.ts:267` 唯一调用点）与「入 BLOCKED」两类。而验收 4 **明列**的四路径中，**超时 FAILED**（`:222-230` return 前无任何钩子）、**崩溃 FAILED**（`:231-242`）、**preSpawnFail CANCELLED**（`:315-321`）、preSpawnFail FAILED（`:322-328`）四类均不产生 DONE 也不产生 BLOCKED，不会被任何声明的挂载触发；`resolveTicket` abort→FAILED（`:361`）与 `recoverOnStartup` FAILED/CANCELLED（`:463/470`）同理。→ 规则 5「任何离开 {DISPATCHED, IN_PROGRESS} 的转移……统一触发」与验收 4 按字面无法实现；impl 自己的测试清单（「饥饿免疫四路径……前单 DONE、超时 FAILED、崩溃 FAILED、入 BLOCKED 各起一排队单」）也无设计支撑——**测试计划与设计不自洽**。
     ② **D2 的「既有装配通道（onTicketSettled 同款）」不存在**：`onTicketSettled` 是 `Dispatcher` 的内部方法（`dispatcher.ts:413`），由 settle 的 DONE 分支直接调用（`:267`），不是 service→dispatcher 的回调；`TicketService` 构造函数（`ticket-service.ts:122-127`）只收 `db/workspaces/guards`，`buildServer`（`app.ts:93-108`）先建 service 后建 dispatcher，二者之间**零回调通道**。故「service 层 BLOCKED 转移回调」必须**新建通道**（service 收 hook 或 dispatcher 持有 service 并 wrap），属设计面新增，而实现该通道的 `app.ts` 未进块 1 清单（`index.ts` 亦未列入，tick 生命周期 `:27` 归属不明）。
     ③ 附带风险：若按 D2 把回调挂在 `transition` 的 `db.transaction` 内（`ticket-service.ts:424-494`），`releaseAndRecheck` 会在事务回调内再调 `service.transition` + 触发 spawn（同步前缀含 mkdir/spawn），引入同态重入与事务内长耗时；顺序/幂等/重入均未在 impl 讨论。
   - 影响：核心机制（单一唤醒入口）在三种「非 DONE 离开执行态」路径上失效——排队单在前单超时/崩溃/派发失败时永久挂起，验收 3/4 直接不达标；Builder 只能自行发明回调通道（生产与测试两条链路的装配形态），重演 S2w1 的「装配/注入面未定义」教训。
   - 建议：① 挂载集改为明确的四类触发点并逐点写文件与函数位：settle 全部出口（DONE/FAILED×2/BLOCKED×2，建议在 settle 尾部收敛为单一 `settleOutcome` 出口后统一调 `releaseAndRecheck`）、`preSpawnFail` 两个出口、`recoverOnStartup` 尾部；BLOCKED 若仍走 service 回调，则明确该回调**监听所有离开执行态的转移**（不只是 BLOCKED），并写死回调签名与事务边界（建议事务提交后回调，避免事务内重入）；② D2 改写为「新建回调通道」，列出装配伪码与涉及的 `TicketService` 构造/`buildServer`/`AppRuntime`/`DispatcherDeps` 字段；③ 块 1 清单补 `apps/server/src/app.ts` 与 `apps/server/src/index.ts`；④ 回调重入/幂等（同一次 settle 只触发一轮重校验）写入风险表与用例。

### high

2. **排队单的 worker 绑定无持久化：唤醒重走放行链时 workerId 丢失，验收 3「settle 后 FIFO 自动恢复」不可执行** — 严重程度：high
   - 位置：impl 改动点 `ticket-service.ts` ②③、技术方案 3、D7；对照 `ticket-service.ts:450-468`（四件套仅 user 分支，`workerId` 只在转移成功时落库 `:477`）、`:438-441`（system 自动放行不传 workerId 也可）
   - 描述：放行请求被排队时「不转移状态」，于是 `o.workerId` 不落库（`:477` 仅在 update 时写入）。手动单在放行弹层选的 worker 是本次请求带入的——排队即丢失。唤醒重走放行链时：若以 user 通道恢复 → 命中 `WORKER_REQUIRED`（`:451-454`，`row.workerId` 为 null）；若以 system 通道恢复（`BLOCKED→DISPATCHED` 是 system 边，`status.ts:41-54` 不含此边）→ 跳过四件套，spawn 时 `worker 未注册或未绑定` 抛错 → `preSpawnFail` → CANCELLED。两条路都失败。impl 未提「排队时持久化 workerId/将放行意图存入 queued 元数据」。
   - 影响：验收 3 的「第一单 settle 后 FIFO 自动恢复」在人工放行场景不成立；只有建单预绑定 worker 的编排链单能恢复。
   - 建议：明确排队时的 worker 绑定承载——或排队即把 `o.workerId` 落 `tickets.worker_id`（复用既有列，不入队不转移），或 queue 元数据扩「待放行 workerId」；并写明唤醒路径用哪条通道（建议 user 通道语义 + 从库中取绑定），补「排队→恢复」用例断言 worker 一致。

3. **闸门/文件冲突校验插入全部 `TASK→DISPATCHED` 边，但只定义了 SPEC_READY 来源的排队语义——reopen 与 resolveTicket reassign 行为未定义，与验收 9 冲突** — 严重程度：high
   - 位置：impl 改动点 `ticket-service.ts` ②、业务规则 3；对照 `status.ts:29-31`（终态→DISPATCHED 为 user 边）、`:27`（BLOCKED→DISPATCHED 为 system 边）、`dispatcher.ts:368-374`（resolveTicket reassign）、`:399-405`（reopen）、`routes/tickets.ts:132-139`
   - 描述：impl 把双校验写在「transition 的 TASK→DISPATCHED 放行前置」这一层，覆盖面远大于「SPEC_READY 放行」：
     ① **reopen**（DONE/FAILED/CANCELLED→DISPATCHED，actor='user'，`dispatcher.ts:399`）：闸门满时按 impl 应「落 queued 字段保持状态」——但排队承载写死为「SPEC_READY + queued_reason/queued_at」（规则 3），终态单没有该状态可保持；文件冲突时则走 user 通道 422（可能与「重开是用户显式动作」的既有语义冲突）。
     ② **resolveTicket reassign**（BLOCKED→DISPATCHED，actor='system'，`dispatcher.ts:368`）：若判为 system 通道则冲突时「排队」，但 BLOCKED 单不可能以 SPEC_READY+queue 承载；若判 user 通道则 422 打断裁决事务（裁决留言已落、状态未变，产生半完成态）。
     ③ 闸门计数集含同 repo 的 DISPATCHED+IN_PROGRESS，存量重开/改派场景极易在默认 `maxConcurrentPerRepo=2` 下被拦，属**存量路径行为变化**，与验收 9「无 plannedFiles/无排队的存量路径行为与 API 契约不变」直接张力。
   - 影响：Builder 需自行裁决三条来源边（SPEC_READY/终态/BLOCKED）的校验适用范围，错选即造成裁决半完成态或闸门旁路；回归面不可判定。
   - 建议：显式写死适用范围——建议校验仅对 `row.status === 'SPEC_READY'` 生效（与偏离 2「排队=放行前等待」语义一致），reopen/reassign 明确「不参与闸门排队」（或改判为「冲突时 422、闸门满时直接放行」并说明理由）；若确需覆盖 reopen，则 queue 承载须扩为「DISPATCHED 目标态的通用等待语义」，并同步规则 3 与 UI 判定条件；同时把这三条边在「回归面」行逐条列出。

4. **`channel` opt 与既有 `actor` 双写不一致；「经既有 `autoDispatch` 标志区分」不成立；D7 与风险表自相矛盾** — 严重程度：high
   - 位置：impl 改动点 `ticket-service.ts` ②、D7、风险表第 4 行；对照 `ticket-service.ts:78-90`（`TransitionOptions.actor`，值域 `'user'|'system'`）、`dispatcher.ts:438-441`（既有自动放行已传 `actor:'system'`）、`dispatcher.ts:28-29` 与 `app.ts:98`（`autoDispatch` 属于 `DispatcherDeps`/`RuntimeOptions`，`TicketService` 不可见）
   - 描述：
     ① 运行通道已由 `actor` 表达（默认 `'user'`，`ticket-service.ts:422`），新增 `channel` 构成同义双字段、双事实源；两者一旦不一致（settle 的 system 转移默认 `channel:'user'`；`resolveTicket` reassign `actor:'system'` 而 `channel` 缺省 `'user'`）冲突分流即错判。
     ② impl 写「system 通道经既有 `autoDispatch` 标志区分」——`TicketService` 未持有 `autoDispatch`（属 Dispatcher/Runtime 选项），按字面无法实现；且 `autoDispatch=false` 是**测试关闭 spawn 的开关**（`test/helpers.ts`、`dispatcher.test.ts`），把它当作通道来源会让测试环境把用户放行误判为 system 通道。
     ③ D7「既有自动放行链调用点显式传 'system'」与风险表「channel/pendingLabel 均缺省兼容，既有调用零改动」互相矛盾（至少 `dispatcher.ts:438` 必须改）；且 `resolveTicket`/`reopen` 两个 `→DISPATCHED` 调用点的通道归类缺失（同问题 3）。
   - 影响：验收 2 的「user 422 / system 排队」分流实现口径不唯一，Builder 可能做出错误的通道判定；测试环境通道错判会掩盖真实回归。
   - 建议：删去 `channel`，统一复用 `actor` 判定通道（`system`=编排链自动放行、`user`=人工放行），并在 impl 逐条列出三个 `→DISPATCHED` 调用点的归类表（`onTicketSettled`→system；`routes/transition`→user；`reopen`→user；`resolveTicket reassign`→待拍板）；风险表「零改动」改为「除 `onTicketSettled`/`resolveTicket` 外的调用点零改动」。

### medium

5. **测试基建缺口：`test/helpers.ts` 未入清单、5s tick 无测试 seam、60/120/240 退避断言不可构造** — 严重程度：medium
   - 位置：impl 块 1 测试行；对照 `test/helpers.ts:73-77`（`createTestContext` 固定 config）、`:132-141/163-172`（`createRealContext` opts 仅 `retryOnReportMiss` 等，无并发/退避注入位）、`dispatcher.ts` D3（setInterval 挂载）
   - 描述：① 验收 3 需要 `maxConcurrentPerRepo=1`、验收 5 需要小退避值才能快速跑，但 `createRealContext` 无 `maxConcurrentPerRepo`/`maxRetries`/`retryBackoffSec` 注入位——`helpers.ts` 必须改，却不在块 1 清单；② D3 的 tick 只写「AppRuntime 挂载/清除」，未给测试可确定性驱动的 seam（手动触发函数 / 注入 tick 间隔 / fake timers），而 vitest 下真等 5s×多轮不可行；③ 测试断言「退避 60-120-240」在单测中不可构造（需等 60s+120s+240s），除非注入 `retryBackoffSec` 并把「封顶 240」改为相对断言，impl 未写。另：`setInterval` 未提 `unref`/`app.onClose` 清理，测试进程可能不退出。
   - 影响：块 1 自验命令（`pnpm -F @atd/server test`）按 impl 字面写不出一批用例，Builder 需自行发明测试基建。
   - 建议：块 1 清单补 `apps/server/test/helpers.ts`（列出 `createRealContext` 新增配置 opts）；D3 写明 tick 的启动/停止入口（如 `dispatcher.startTicker()/stopTicker()` + `AppRuntime` 暴露 `recheck()` 手动触发）与 `unref`；退避用例改为「注入 `retryBackoffSec` → 断言相对序列 + 封顶」并注明与 60/120/240 的换算。

6. **`planned_files`（TEXT JSON）→ 契约 `plannedFiles: string[]` 的转换无落点** — 严重程度：medium
   - 位置：impl 改动点 `db/schema.ts` 行、`ticket-service.ts` ⑥、契约冻结第 3 条；对照 `ticket-service.ts:109-111`（`toTicket` 仅 spread row）、`:257-262`（list 映射）
   - 描述：schema 落 `planned_files text`（JSON 数列），契约冻结承诺 `plannedFiles: string[]|null`。二者之间必须有一次 `JSON.parse`（含非法值容错），impl 未在任何改动点声明该转换归属（`toTicket`？list 映射？），`updateTicket`/`submitSpec` 的写入侧序列化位置亦未写。
   - 影响：Builder 可能让 DB 字符串直穿 API，运行期前端拿到 `"[...]"` 字符串——契约「已冻结」实际未闭合，块 2 手抄后的类型断言失真。
   - 建议：明确「写入：`JSON.stringify(plannedFiles)`；读出：`toTicket` 内 `JSON.parse`（非法/空串 → null）」并补一条单测（含空数组视同未声明 → null）。

7. **retry 上限升级（「留 BLOCKED 改 `pendingLabel='l3'` + `blockReason` 摘要」）的更新机制未声明** — 严重程度：medium
   - 位置：impl 技术方案 4、D6；对照 `status.ts:27`（`TRANSITIONS` 无 BLOCKED→BLOCKED）、`ticket-service.ts:430-431`（非法边直接 422）、`:475-476`
   - 描述：规格要求第 maxRetries 次失败后「留 BLOCKED、改 `pendingLabel='l3'`、`blockReason` 记历次摘要」。同态更新（BLOCKED→BLOCKED）不是合法转移边，`transition()` 会抛 `INVALID_TRANSITION`；只能靠新增 service 方法（如 `markRetryExhausted`）或把「判定升级」前移到 settle 一次落 l3。impl 未指明落在哪一步、用哪个接口，也未说明 `retry_count` 是否叠加历次摘要的来源（`ticket_reports` 按 round 查）。
   - 影响：Builder 可能直接用裸 SQL 改列（绕过域层）或重复进入 RETRY_WAIT，升级路径不确定。
   - 建议：写死升级判定点与接口——建议在 settle 的报告缺失分支内：`retry_count+1 >= maxRetries` 时以 `pendingLabel:'l3'` + 摘要 `blockReason` 一次性转 BLOCKED（避免同态更新），并补用例断言 label/摘要内容。

8. **`startRound` 立即重试循环（`runOnce` 返回 boolean 的契约）改造未列入改动点** — 严重程度：medium
   - 位置：impl 改动点 `dispatcher.ts` ②；对照 `dispatcher.ts:67-72`（`while (retry) retry = await this.runOnce()`）、`:296-299`（返回 true=立即重试）
   - 描述：报告缺失从「立即同 worktree 重试」改为「BLOCKED+retry_at，由 tick 唤醒」后，`runOnce` 的 `true` 返回值语义与 `startRound` 的 while 循环必须一并移除/改造（否则 `settle` 返回 true 会继续立即重试，与 RETRY_WAIT 语义冲突）。impl 只在测试行写「B6 更新（立即重试→倒计时）」，未把循环结构改造列为改动点。
   - 影响：遗漏点会导致新旧语义并存（BLOCKED 后被 `startRound` 立刻再 spawn）。
   - 建议：改动点 ② 补「移除 `startRound` 的 while 与 `runOnce` 的 boolean 返回值（或恒返回 false），重试闭环移交 tick」，并注明 `RoundResult`/`settle` 签名影响。

9. **块 2 文件集不完备：`TransitionActions.tsx`（`submitSpec` 第二调用点）未列入；`plannedFiles` 录入 UI 归属未定** — 严重程度：medium
   - 位置：impl 块 2 清单；对照 `web/src/pages/WorkbenchPage.tsx:80`、`web/src/components/TransitionActions.tsx:88`（`submitSpec(id, specContent)` 两个调用点）
   - 描述：块 2 只列 `WorkbenchPage`，但 `submitSpec` 的另一调用点 `TransitionActions.tsx` 未列（该组件同时负责 SPEC_READY 放行按钮，正落本次改动面）。更重要的是：`plannedFiles` 声明经 `submitSpec` 请求体，但 impl 未定义**前端录入入口**（哪个组件收集 plannedFiles、随 spec 提交），若不加录入则 `plannedFiles` 参数永远为 undefined——spec 范围「plannedFiles 可选声明」在 UI 侧空转。
   - 影响：web 块自行发明录入面，或漏改调用点导致「UI 无法声明 plannedFiles」。
   - 建议：块 2 清单补 `TransitionActions.tsx`；明确录入入口（建议并入提交 spec 弹层，TextArea 每行一路径 + 尾斜杠目录提示）并列入 `WorkbenchPage` 行；若决定首版不做 UI 录入（仅 API 支持），在 impl 显式标注该决策与理由（供用户确认）。

10. **D4 探针缺可执行步骤与确定性验收判据** — 严重程度：medium
    - 位置：impl D4；对照 `drizzle/meta/_journal.json:26-32`（idx=3 存在）、`drizzle/meta/`（止于 `0002_snapshot.json`）、`apps/server/package.json:11`（`db:generate`）、`drizzle-kit` 已在 devDeps
    - 描述：现状核对**属实**（journal 有 0003 entry、`meta/` 无 `0003_snapshot.json`），指出问题方向正确。但修复步骤只写「补 0003 期 snapshot / 冲突则手工校正 journal」，未给可执行做法（drizzle-kit 不会为已存在的 tag 回补 snapshot——需临时把 schema 回退到 0003 期状态生成、或手写 snapshot JSON 并与实际库校验），也未定义可验证的完成判据（「以最终 generate 校验通过为验收」缺少判定动作：生成后 0004 快照链完整 + 对临时库 migrate 成功 + 列不重复）；「两小时内无法收敛」不是可验证判据。
    - 影响：Builder 在探针上可能反复试错；预算判据不可执行，无法向上汇报收敛/回退的分界。
    - 建议：把 D4 写成步骤清单（① 手写/回填 `0003_snapshot.json`（与 `0003_s2w1_blocker_inline.sql` 一致）→ ② `pnpm -F @atd/server db:generate` 确认仅含 0004 差异 → ③ 临时库跑全量 migrate + 关键列 `PRAGMA table_info` 校验 → ④ 快照/journal 一致性检查）；fallback 判据改为「步骤②产出含 0003 期重复列即判定探针失败」。

### low

11. **`report.ts` 行「与 commit 提取同源 `execGit` 通道」表述不实** — 严重程度：low
    - 位置：impl 改动点 `report.ts` 行；对照 `report.ts:1/44-48`（现为 `execFileSync('git', [...])` 内联，无 `execGit` 助手）
    - 描述：仓内不存在 `execGit` 通道；`listNewCommits` 用 `git log --format=%H <baseline>..HEAD`，而新函数描述为 `git diff --name-only <baseline> <head>`。「同源」指 same baseline 即可，但字段名/取法需对齐（`headSha` 在 settle 中实际取 `HEAD`）。
    - 影响：Builder 找不到该助手，可能新增抽象或猜测参数。
    - 建议：改为「与 `listNewCommits` 同一 `execFileSync('git', …)` 调用形态与同一 baseline；`headSha` 取 `'HEAD'`」。

12. **验收 9 的兼容口径与 `Ticket` 新增 5 字段的响应增量未对齐说明** — 严重程度：low
    - 位置：impl 契约冻结第 3 条、验收 9 映射；对照 `web/src/api/types.ts:57-81`
    - 描述：「存量路径 API 契约不变」与「TicketListItem/TicketDetail 增 5 字段」并存——属向后兼容增量而非契约不变；块 2 手抄若要严格对齐需同步 `Ticket` 必填字段（`retryCount: number` 非空），存量 DB 行由 `DEFAULT 0` 兜底。
    - 影响：措辞含糊，回归判定时可能被误读为「响应体不变」。
    - 建议：验收 9 补一句「新增字段为向后兼容增量（前端 tolerant），存量路径的行为断言不变」。

13. **`api.test.ts` 与新增 `api-s3.test.ts` 二选一未定** — 严重程度：low
    - 位置：impl 块 1 测试行（「`api.test.ts`（或新增 `api-s3.test.ts`）」）；对照 `test/` 目录已有 `api-s2a.test.ts` 先例
    - 描述：文件名「或」不定，Builder 需自选；既有命名先例（`api-s2a.test.ts`）支持新文件。
    - 建议：直接定为 `apps/server/test/api-s3.test.ts`（与 `api-s2a.test.ts` 对称），避免改动既有大文件。

## 观测（不计分，供 rev2 参考）

1. **契约面正向核对**：`routes/types.ts` 是 server 侧契约镜像（`:12-17` 显式声明「块 B 以此为参照手抄」），impl 将其与运行时改动同归块 1——符合「契约类型与运行时改动同块拥有」的正确模式，块 2 仅手抄，两块文件无交叠。
2. **排队返回不会误触发 spawn（既有守卫已在）**：`routes/tickets.ts:137` 的触发条件是 `updated.type==='TASK' && updated.status==='DISPATCHED'`，排队路径返回 `SPEC_READY` 时不会调 `onDispatched`——impl 的「放行 API 返回 `{ticket}`」契约与现有路由天然兼容，无需改路由（impl 未提，属正向确认）。
3. **B6 用例真实存在**：`dispatcher.test.ts:262` 「B6：报告缺失——L2 重试（round=2 可见）→ 仍缺 → L3 BLOCKER」，并传 `retryOnReportMiss:1`（`:266`）——impl 的「B6 更新」有真实对应物；`retryOnReportMiss` 读取点唯一（`dispatcher.ts:297/300`），D5 改造面小。
4. **零新增转移边可行性已实证**：`status.ts:27` 含 `BLOCKED→DISPATCHED`（system 边，`:41-54` 的 `isUserEdge` 不含），RETRY_WAIT 恢复无需动状态机；`SPEC_READY` 放行与排队承载不新增边，与 spec 偏离 2/规则「零新增」一致。
5. **`pendingLabel` 参数化落点精确**：现硬编码处为 `ticket-service.ts:475`（`to==='BLOCKED'` 时写 `'l3'`），impl 的「参数化 + 缺省 'l3' + user 通道行为不变」可精确对应；`schema.ts:28` 注释已预留「后续版本扩 'agent'」。
6. **D4 现状复核**：`drizzle/meta/` 目录仅 `0000/0001/0002` 三个 snapshot，`_journal.json` 有 idx=3（`0003_s2w1_blocker_inline`）——impl 描述的「journal 有 entry 而 meta 止于 0002」属实；`drizzle-kit ^0.31` 与 `db:generate` script 均在仓内可用（依赖满足）。
7. **错误码机制匹配**：`errors.ts:2-43` 为封闭 union + 全量 `ERROR_STATUS: Record`，新增 `FILE_SET_CONFLICT` 须两处同步（tsc 强制），impl 已列该文件；`details` 为 `string[]`，与冻结的 `details: ['单 N 与单 M 文件集相交: …']` 形态一致。
8. **web 锚点全部真实**：`useNow`（`utils/hooks.ts:25`）、`BlockedResolutionCard`（组件存在，`WorkbenchPage.tsx:342`/`TicketDetailPage.tsx:172` 使用）、工作台双区（`WorkbenchPage.tsx:138`「阻塞与待裁决」/`:199`「待处理」）、列表页 BLOCKED 徽标位（`TicketListPage.tsx:133-136`）——块 2 改动点可挂载。
9. **退避口径与验收 4 一致（正向）**：D6 `min(backoff×2^(retry_count−1), 240)` + `retry_count` 首次=1 + 升级 `>=maxRetries(3)` ⇒ 60/120/240 三次后升级，与 spec 验收 5 逐字吻合。

## 结论

# REJECT

状态：IMPL_REVIEWING → IMPL_DRAFT

一句话理由：骨架、spec 覆盖（10 条验收 8 条有落点）与双块切分成立，D6 自洽、D4 现状属实；但 `releaseAndRecheck` 的挂载集漏掉验收 4 明列的「超时/崩溃 FAILED 与 preSpawnFail CANCELLED」三类路径，且 D2 所称「AppRuntime 既有装配通道」不存在（`onTicketSettled` 仅 DONE 触发；service↔dispatcher 无回调通道）、`app.ts`/`index.ts`/`test/helpers.ts` 未入块 1 清单（问题 1/5）——建议按 1 critical + 3 high + 5 medium（+4 low 顺手对齐）修订后过审。
