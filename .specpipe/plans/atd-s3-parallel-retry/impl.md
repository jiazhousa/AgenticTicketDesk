# Impl: S3 并行执行与排队/自愈引擎

- **topic**：atd-s3-parallel-retry
- **上游 spec**：`.specpipe/plans/atd-s3-parallel-retry/spec.md`（v3.1，SPEC_APPROVED）
- **基线**：main@8456548
- **修订记录**：r1 REJECT 6 → v2；r2 REJECT 47 → v3；r3 REJECT 80 → **v4**（本版，文档层收敛）：D6 升级判定改「先判后等」（maxRetries=3 → 60/120/240 三次等待全可达）/plannedFiles 录入入口移至 submitSpec 提交弹层（TransitionActions:88+WorkbenchPage:80，SpecCard 改只读）/tick 挂载=Fastify onClose 清理+回调箭头包裹防 this 丢失/取消清空 queued 补全/tick 每单异常隔离/helpers config 三键透传

## 技术方案

总体策略：server 一次成块、web 独立成块（契约冻结先行）——文件集不相交可并行派发。

**核心机制落点**：

1. **排队不走状态机**：闸门满（两通道）/文件冲突（仅 system 通道）→ 保持 SPEC_READY，落 `queued_reason`/`queued_at` + `worker_id`（早绑定）；放行 API 返回 `{ticket}`
2. **校验作用域 = 仅新放行边（SPEC_READY→DISPATCHED）**；reopen/resolveTicket 恢复语义直执行（瞬时超闸接受，风险 R4）
3. **双集合**：`闸门计数集` = 同 repo DISPATCHED+IN_PROGRESS；`文件集占用集` = 前者 + SPEC_READY 排队中 + BLOCKED（任何 pendingLabel）
4. **排队入口校验顺序（写死）**：四件套先行（workerId 必填→∈Registry→worktree 可建→repoRef 复校[仅 user 通道，复用既有 actor 分流：`TransitionOptions.actor`（`ticket-service.ts` 约 :80）/user=`routes/tickets.ts:133`/system=`dispatcher.ts:438` 同款]）→ 四件套全过 → 闸门/文件集检查 → 不满足则落 worker_id+queued 两字段返回。**排队单 = 四件套已全过的「随时可放行」单**；唤醒时仅重查 Registry∈（worker 可能被删，轻量）+ 闸门 + 文件集，不重查 worktree/repoRef（system 语义）
5. **唤醒挂载全集（r2-critical 闭合）**——`releaseAndRecheck()` 单一实现，三类挂载：
   - **dispatcher 内部直调（八处，转移落库后）**：settle DONE；settle FAILED-超时（约 :222）；settle FAILED-崩溃（约 :231）；**settle BLOCKED-卡点（worker 报 blocked，IN_PROGRESS→BLOCKED，约 :270-294——r2 补）**；settle BLOCKED-RETRY_WAIT 入口（报告缺失/schema 错）；preSpawnFail→CANCELLED（约 :315，DISPATCHED→CANCELLED）；preSpawnFail→FAILED（约 :323，IN_PROGRESS→FAILED——r2 补）；resolveTicket abort→FAILED（约 :361，BLOCKED→FAILED）
   - **service 层回调（枚举写死：仅两条 user 取消边）**：DISPATCHED→CANCELLED、BLOCKED→CANCELLED（`status.ts:49` 证实 user 边）。回调契约：**setter 注入** `service.onInflightReleased = (ticketId) => void`（`app.ts` 现装配顺序 service 先于 dispatcher，构造注入不可行——r2-m1 修正）；**事务边界：转移 DB 提交成功后 fire-and-forget 调用，回调异常 log 不抛**（不阻塞 user 请求路径）
   - **启动扫描**：recoverOnStartup 末尾排队单重校验一轮
6. **RETRY_WAIT 引擎**：报告缺失/schema 错 → IN_PROGRESS→BLOCKED('agent') + retry_count 递增；**升级判定=先判后等：递增后若 `retry_count > maxRetries` 当次同态升级（不安排等待）；否则安排 `retry_at=now()+min(retryBackoffSec×2^(retry_count-1), 240)`**（maxRetries=3：count 1/2/3 → 60/120/240 三档全可达，第 4 次进入即升级——三次重试后升级，与验收 5 一致）。升级=pending_label 'agent'→'l3' + blockReason 历次摘要 + system comment（无 transitions 行）。5s tick 扫到期单（**每单 try/catch 隔离，单单失败不影响他单，异常 log**）→ **恢复顺序写死：先查闸门（自身一直在占用集，文件集不复验——BLOCKED 期间占用保留，占用集单调无新增冲突面）→ 闸门满则 retry_at 顺延一个 tickInterval 下轮再试（不落 queued 字段不转移状态）→ 有位则 BLOCKED→DISPATCHED（actor=system）重 spawn round+1**；spawn 失败走既有 preSpawnFail。continue/reassign/reopen 清零 retry_count
7. **实测防线**：settle DONE 提取基线 diff 文件清单（复用 `report.ts` 既有 git 调用通道，与 commit 提取同源）落 `ticket_files`，与占用集声明单交叉比对 → 相交两单各落 system 留言
8. **seam 注入通路（r2-m3 贯通）**：`DispatcherDeps`（`dispatcher.ts` 约 :20 现有构造 deps）扩 `tickIntervalMs?: number`（缺省 5000）与 `now?: () => number`（缺省 Date.now）；通路：测试 → `test/helpers.ts`（工厂扩 deps 透传）→ `RuntimeOptions` → `buildServer` → Dispatcher；退避断言经注入 now 构造

## 改动点

### 块 1：server（引擎全量）

| 文件 | 改动 |
|---|---|
| `apps/server/src/db/schema.ts` | tickets +retry_count（integer NOT NULL DEFAULT 0）+retry_at（integer 可空）+planned_files（text 可空 JSON 数列字符串）+queued_reason（text 可空）+queued_at（integer 可空）；新表 ticketFiles（ticket_id/round/path，UNIQUE(ticket_id, round, path)） |
| `apps/server/drizzle/0004_s3_parallel.sql` + `meta/` | migration 0004 + snapshot 链修复（D4）+ journal entry |
| `apps/server/src/config.ts` | +maxConcurrentPerRepo（2）/maxRetries（3）/retryBackoffSec（60）；retryOnReportMiss optional 读取位——读到 warn 忽略 |
| `config.yaml` | +3 键；删 retryOnReportMiss 行 |
| `apps/server/src/domain/errors.ts` | +FILE_SET_CONFLICT（422，details 双单号+相交文件） |
| `apps/server/src/domain/file-set.ts`（新） | 精确路径+目录前缀（`dir/` 递归）；`intersects(a,b)` 双向复用 |
| `apps/server/src/domain/ticket-service.ts` | ① setter `onInflightReleased` ② submitSpec body 扩 plannedFiles（zod 校验→JSON.stringify 落库；detail/list 读侧 JSON.parse 还原 `string[]\|null`）③ 仅 SPEC_READY→DISPATCHED 边：四件套（既有）→闸门/文件集（新）→不满足落 worker_id+queued 返回；文件冲突 user 抛 422/system 落排队（actor 分流复用 `TransitionOptions.actor` 既有机制）④ transition opts 增 pendingLabel?（仅 IN_PROGRESS→BLOCKED 生效，缺省 'l3'）⑤ DISPATCHED→CANCELLED、BLOCKED→CANCELLED 成功提交后调 onInflightReleased；**任何离开 SPEC_READY 的转移（DISPATCHED 放行成功/CANCELLED 取消）清空 queued 两字段** ⑥ 双集合查询函数 ⑦ list/detail 透出 5 字段 |
| `apps/server/src/dispatcher.ts` | ① `releaseAndRecheck()`：FIFO 按 queued_at，重查 Registry∈+闸门+文件集（技术方案 4），满足则 DISPATCHED（actor=system）+spawn；**八处直调挂载**（技术方案 5 列表，含 r2 补的 settle-BLOCKED-卡点 与 preSpawnFail→FAILED）② settle 判定表报告缺失/schema 错分支（retryOnReportMiss 消费点）：**移除 startRound 内立即 bumpRound+respawn 循环（现状 L2 分支的 while/续跑结构一并改造为单次返回 RETRY_WAIT 结果），改入 BLOCKED('agent')+升级判定（技术方案 6）**③ 5s tick（opts seam，技术方案 8）扫到期单按恢复顺序执行（技术方案 6）④ resolveTicket abort 分支尾直调 releaseAndRecheck ⑤ settle DONE：report.ts 新函数提取实测文件落 ticket_files+交叉预警 ⑥ recoverOnStartup：RETRY_WAIT（到期即恢复）+排队单重校验 |
| `apps/server/src/app.ts` | 装配：dispatcher 构造后 `service.onInflightReleased = (ticketId) => dispatcher.releaseAndRecheck(ticketId)`（**箭头包裹防 this 丢失**；签名统一 `(triggerTicketId?: number) => void`——定向按触发票 workspace+repoRef 重校验排队单，tick/启动扫描不传参走全量；r4-l3 签名一致性）；tick 挂载=buildApp 构建 Dispatcher 时启动，**清理挂 Fastify `app.addHook('onClose')` 清 interval**（AppRuntime 无生命周期概念——r3-l1 修正） |
| `apps/server/src/index.ts` | 启动时序核对：recoverOnStartup 扩展后仍在监听前完成 |
| `apps/server/src/report.ts` | +extractTouchedFiles(repoPath, baselineSha, headSha)：`git diff --name-only`（rename 显示路径），复用本文件既有 git 调用通道 |
| `apps/server/src/routes/tickets.ts` | submitSpec body parse 扩 plannedFiles；list/detail 自然透出 |
| `apps/server/src/routes/types.ts` | TicketListItem/TicketDetail +queuedReason/queuedAt/retryCount/retryAt/plannedFiles（submitSpec 入参为 routes 层内联 zod，不新增独立 Body 类型） |
| `apps/server/test/helpers.ts` | 工厂扩 DispatcherDeps 透传（tickIntervalMs/now）**与 config 三键透传（maxConcurrentPerRepo/maxRetries/retryBackoffSec）**（r3-l5）+双并行 fake worker 支持（两单独立实例与断言钩子） |
| `apps/server/test/ticket-service.test.ts` | +：plannedFiles 冻结与 JSON 往返/排队入口校验顺序（四件套先行：无 workerId 仍 WORKER_REQUIRED 不入队）/闸门两通道分流+worker_id 早绑定/文件冲突 422 与 system 排队/pendingLabel 参数化/两条 user 取消边回调触发（提交后 fire-and-forget）/DISPATCHED 清空 queued/双集合口径/reopen 与 reassign 不入队 |
| `apps/server/test/file-set.test.ts`（新） | 匹配边界：前缀/嵌套/根/尾斜杠/未声明跳过 |
| `apps/server/test/dispatcher.test.ts` | B6 更新（立即重试→入 BLOCKED('agent')：注入 now 断言 retry_at；maxRetries 边界断言当次升级）；+：闸门排队 FIFO 恢复（前单 DONE）/​**饥饿免疫四路径对齐 spec 验收 4：超时 FAILED/崩溃 FAILED/preSpawnFail CANCELLED/卡点 BLOCKED（worker 报 blocked→BLOCKED 后排队单被唤醒——r2 修正）**/user 取消边释放（DISPATCHED→CANCELLED 回调路径）/abort→FAILED 直调路径/退避 60-120-240（注入 now 构造）/升级 blockReason 摘要+system comment+无 transitions 行/tick 恢复闸门满顺延一 tick（不落 queued）/重启恢复/实测预警双留言/两单并行真跑隔离（双 fake worker） |
| `apps/server/test/api-s3.test.ts`（新） | FILE_SET_CONFLICT 422 details 结构/放行排队响应（queuedReason+workerId 可查）/新字段透出/submitSpec plannedFiles 校验 422 |

**块 1 最小验证**：`pnpm -F @atd/server exec tsc --noEmit && pnpm -F @atd/server test`

### 块 2：web（UI 与契约手抄）

| 文件 | 改动 |
|---|---|
| `apps/web/src/api/types.ts` | 手抄契约同步（对齐 routes/types.ts 增量逐字段） |
| `apps/web/src/api/tickets.ts` | submitSpec 参数扩 plannedFiles |
| `apps/web/src/components/QueuedTag.tsx`（新） | 排队徽标：GATE_QUEUED/FILE_CONFLICT 文案+时刻 |
| `apps/web/src/components/SpecCard.tsx` | **只读展示 plannedFiles**（SPEC_READY 后）；DRAFT 编辑态不涉（plannedFiles 随 submitSpec 提交，不走 PATCH updateTicket——r3-m2 修正归属） |
| `apps/web/src/components/TransitionActions.tsx` | **plannedFiles 录入入口（r3-m2 修正）**：spec 提交弹层（本组件约 :88）增文本域（每行一个路径，尾斜杠目录语义提示），随 submitSpec 提交；放行按钮渲染点：排队单（queuedReason 非空）禁用放行+显示 QueuedTag |
| `apps/web/src/pages/WorkbenchPage.tsx` | 待处理区：排队单 QueuedTag+隐藏放行按钮；**快捷 spec 提交入口（约 :80）同步增 plannedFiles 文本域**；阻塞区按 pendingLabel 分流——l3 走 BlockedResolutionCard；agent 只读卡（重试次数/useNow 倒计时） |
| `apps/web/src/pages/TicketListPage.tsx` | BLOCKED 行 pendingLabel 徽标；SPEC_READY 排队行 QueuedTag |
| `apps/web/src/pages/TicketDetailPage.tsx` | 排队信息展示（原因/时刻）；BLOCKED agent 态只读重试信息，不渲染裁决卡 |

**块 2 最小验证**：`pnpm -F @atd/web build`

## API 契约冻结（块 2 并行依据）

- 放行 `POST /api/tickets/:id/transition` 响应不变（`{ticket}`）；排队判定=`ticket.status==='SPEC_READY' && ticket.queuedReason`；user 通道闸门满同此（不报错）
- 新错误码 `FILE_SET_CONFLICT`（422）：`{error: {code, message, details: ['单 N 与单 M 文件集相交: a.ts, dir/', ...]}}`
- TicketListItem/TicketDetail 新字段：`queuedReason: 'GATE_QUEUED'|'FILE_CONFLICT'|null`、`queuedAt: number|null`、`retryCount: number`、`retryAt: number|null`、`plannedFiles: string[]|null`
- `POST /api/tickets/:id/spec` body：`{specContent, plannedFiles?: string[]}`（routes 层内联 zod 扩展）

## 技术决策

- D1 排队承载=独立列+worker_id 早绑定；不复用 blockReason
- D2 回调=setter 注入（装配顺序事实：service 先于 dispatcher 构造）；枚举仅两条 user 取消边；提交后 fire-and-forget（异常 log 不抛）；abort 在 dispatcher 内直调不经回调
- D3 tick=dispatcher 内 setInterval（deps：tickIntervalMs/now）；挂载=buildApp 构建 Dispatcher 时启动，清理=Fastify `onClose` 钩子（AppRuntime 无生命周期概念）；**tick 扫描与 releaseAndRecheck 唤醒轮均每单 try/catch 隔离（异常 log 不中断批次——r4-l4）**
- D4 snapshot 修复步骤判据：①generate 首跑（预期 meta 断链报错或脏 0004）②手补 0003_snapshot.json（0002 基+tickets 增 block_reason 列——0003 DDL 全集仅此）③重跑 generate——**判据：0004 仅含 S3 变更（5 列+1 表）无 0003 重复项** ④migrate 后既有测试全绿为终判据；fallback：手写 0004 SQL+snapshot（generate 通过为验收）
- D5 retryOnReportMiss optional 读取位 warn 忽略；config.yaml 删键
- D6 退避：retry_count 进入递增（首次=1）；**先判后等——递增后 `retry_count > maxRetries` 当次升级，否则安排 `min(retryBackoffSec×2^(retry_count-1), 240)`**（maxRetries=3 → 三档 60/120/240 全可达）；continue/reassign/reopen 清零
- D7 通道分流复用 `TransitionOptions.actor` 既有机制（r2 实证：`ticket-service.ts` 约 :80 定义、user=`routes/tickets.ts:133`、system=`dispatcher.ts:438`、repoRef 复校仅 user 分支约 :450）
- D8 校验作用域限新放行边；reopen/resolveTicket 直执行
- D9 tick 恢复语义：先闸门后放行；闸门满 retry_at 顺延一 tick；文件集不复验（占用单调）

## 依赖

- 块 2 依赖契约冻结节（先行）；D4 依赖 drizzle-kit 环境

## 风险

| 风险 | 缓解 |
|---|---|
| settle/回调链复杂度 | 八直调+两回调+启动扫描挂载清单与用例一一对应（四路径对齐 spec 验收 4） |
| drizzle snapshot 不确定性 | D4 判据+fallback |
| B6 等既有用例语义更新 | dispatcher.test.ts 改动行显式列出；api-s3.test.ts 独立文件承接新 API 用例（不动既有 api.test.ts） |
| reopen/reassign 绕闸瞬时超闸 | MVP 接受（闸门防新放行洪峰非硬 invariant），记档 |
| 签名/装配面改动波及 | D2 setter/D7 复用既有 actor——既有调用零语义变化；tsc 全量把关 |
