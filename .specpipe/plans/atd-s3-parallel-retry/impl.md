# Impl: S3 并行执行与排队/自愈引擎

- **topic**：atd-s3-parallel-retry
- **上游 spec**：`.specpipe/plans/atd-s3-parallel-retry/spec.md`（v3.1，SPEC_APPROVED）
- **基线**：main@8456548
- **r1 修订**：2026-09-25 impl-review r1 REJECT 6——critical×1（唤醒挂载集不全+装配通道不存在）/high×3（排队 worker 绑定丢失/校验作用域波及 reopen·reassign/channel 与 actor 双写）/medium×5（测试 seam/JSON 转换落点/升级机制/立即重试移除落点/D4 步骤）全闭合，见技术方案与决策

## 技术方案

总体策略：server 侧一次成块（引擎强耦合不拆）、web 侧独立成块（契约冻结先行）——两块文件集不相交可并行派发。

**核心机制落点**：

1. **排队不走状态机**：闸门满（两通道）/文件冲突（仅 system 通道）→ 工单保持 SPEC_READY，落 `queued_reason`/`queued_at`，**同时落 `worker_id`（早绑定，复用既有列——唤醒重走放行链的前提）**；放行 API 返回 `{ticket}`
2. **校验作用域 = 仅新放行边（SPEC_READY→DISPATCHED）**：reopen（终态→DISPATCHED）与 resolveTicket（BLOCKED→DISPATCHED/IN_PROGRESS）是既有执行的恢复/换手语义，**不排队不复校直接执行**（瞬时超闸可能，记档接受——见风险 R4）
3. **双集合查询**：`闸门计数集` = 同 repo（workspace+repoRef）DISPATCHED+IN_PROGRESS；`文件集占用集` = 前者 + SPEC_READY 排队中 + BLOCKED（任何 pendingLabel，非终态保留声明）
4. **唤醒触发全集（r1-critical 闭合）**——`releaseAndRecheck()` 单一实现，两类挂载：
   - **dispatcher 内部直调**（同对象，无回调）：settle DONE；settle FAILED（超时 `dispatcher.ts` 约 :222）；settle FAILED（崩溃 约 :231）；preSpawnFail→CANCELLED（约 :315）；RETRY_WAIT 入 BLOCKED（IN_PROGRESS→BLOCKED 后）
   - **service 层经新建回调通道**：TicketService 构造注入 `onInflightReleased?: (ticketId: number) => void`——**该通道为本 Story 新建**（r1 核对确认现状不存在：`onTicketSettled` 是 Dispatcher 内部方法仅 DONE 分支调用，`app.ts` 装配面无 service↔dispatcher 回调）。触发点 = service.transition/resolveTicket 中所有离开 {DISPATCHED, IN_PROGRESS} 的 user 边成功路径：DISPATCHED→CANCELLED、BLOCKED→CANCELLED、BLOCKED→FAILED（abort 裁决）。app.ts 装配时接线 `service.onInflightReleased = dispatcher.releaseAndRecheck`
   - **启动扫描**：recoverOnStartup 末尾对全部排队单重校验一轮
5. **RETRY_WAIT 引擎**：报告缺失/schema 错 → IN_PROGRESS→BLOCKED(pendingLabel='agent') + retry_at；5s tick 扫到期单 → BLOCKED→DISPATCHED 重 spawn（round+1）；`retry_count` 达 `maxRetries` → **同态升级**：不转移状态，字段级更新 pending_label='agent'→'l3' + blockReason=历次失败摘要 + system comment 留痕（label 是 BLOCKED 子标签非状态转移，不写 ticket_transitions 行；审计载体=system comment）；人裁决 continue/reassign 或 reopen 后 retry_count 清零
6. **实测防线**：DONE settle 提取基线 diff 文件清单（与 commit 提取同源）落 `ticket_files`，与占用集声明单交叉比对，相交 → 两单各落 system 留言预警（不改状态）

## 改动点

### 块 1：server（引擎全量）

| 文件 | 改动 |
|---|---|
| `apps/server/src/db/schema.ts` | tickets +`retry_count`（integer NOT NULL DEFAULT 0）+`retry_at`（integer 可空）+`planned_files`（text 可空，JSON 数列字符串）+`queued_reason`（text 可空）+`queued_at`（integer 可空）；新表 `ticketFiles`（`ticket_files`：ticketId/round/path，UNIQUE(ticket_id, round, path)） |
| `apps/server/drizzle/0004_s3_parallel.sql` + `meta/` | migration 0004 + snapshot 链修复（D4 步骤化）+ journal entry |
| `apps/server/src/config.ts` | +`maxConcurrentPerRepo`（缺省 2）/`maxRetries`（缺省 3）/`retryBackoffSec`（缺省 60）；`retryOnReportMiss` 保留 optional 读取位——存在即 `console.warn` 忽略（D5） |
| `config.yaml` | +3 新键；删 `retryOnReportMiss` 行 |
| `apps/server/src/domain/errors.ts` | +`FILE_SET_CONFLICT`（422，details 含双方单号+相交文件） |
| `apps/server/src/domain/file-set.ts`（新） | 匹配单一实现：精确路径+目录前缀（`dir/` 尾斜杠递归包含）；`intersects(a, b)`；前置校验与实测预警双向复用 |
| `apps/server/src/domain/ticket-service.ts` | ① 构造注入 `onInflightReleased` 回调（见技术方案 4）② submitSpec body 扩 `plannedFiles?: string[]`（zod 校验后 `JSON.stringify` 落 `planned_files`；读侧 detail/list mapper `JSON.parse` 还原 `string[]\|null`——r1-m2 落点）③ **仅 SPEC_READY→DISPATCHED 放行边**插双校验：闸门满→两通道一律「先 update worker_id（请求携带则更新）+ 落 queued 两字段」返回（不转移状态）；文件冲突→user 通道抛 FILE_SET_CONFLICT、system 通道同前排队——通道分流复用 S2w1 已有 user/system 区分机制（repoRef 复校同源：自动放行链调用点显式标 system，具体载体为 transition 现有 operator/actor 字段，以 `ticket-service.ts` 现状签名为准，**不新增 channel opt**——r1-h3 闭合）④ transition opts 增 `pendingLabel?`（仅 IN_PROGRESS→BLOCKED 边生效，缺省 'l3'——现硬编码处参数化，user 通道行为不变）⑤ DISPATCHED/CANCELLED 转移成功后清空 queued 两字段并调 `onInflightReleased` ⑥ 双集合查询函数（gateCount/occupancySet）⑦ TicketListItem/TicketDetail 增 5 字段透出（含 plannedFiles 反序列化） |
| `apps/server/src/dispatcher.ts` | ① `releaseAndRecheck()`：FIFO 按 queued_at 重走完整放行前置链（闸门+文件集+workerId∈Registry），满足则 DISPATCHED+spawn，否则保持；**五处内部直调挂载**（技术方案 4 列表）② settle 判定表报告缺失/schema 错分支（现状 `retryOnReportMiss` 消费点，L2 立即重试循环）**移除立即 bumpRound+respawn，改 RETRY_WAIT 流程**：IN_PROGRESS→BLOCKED(pendingLabel='agent')+retry_at（`now() + min(retryBackoffSec × 2^(retry_count-1), 240)`，retry_count 进入时递增）③ 5s tick（opts 注入 `tickIntervalMs` 缺省 5000 与 `now()` 缺省 Date.now——r1-m1 seam；AppRuntime 挂载/清除）到期经完整放行前置链恢复，spawn 失败走既有 preSpawnFail→CANCELLED ④ 升级：tick 内 retry_count≥maxRetries 走同态升级（技术方案 5）⑤ settle DONE：调 report.ts 新函数提取实测文件落 ticket_files + 对占用集声明单交叉预警 ⑥ recoverOnStartup 扩：RETRY_WAIT 单（已到期立即恢复）+ 排队单重校验 |
| `apps/server/src/app.ts` | 装配接线：`service.onInflightReleased = (id) => dispatcher.releaseAndRecheck(id)`；tick 挂载/清除进 AppRuntime 生命周期（r1-critical 连带闭合） |
| `apps/server/src/index.ts` | 启动流程核对：recoverOnStartup 扩展后的调用时序（serve 监听前完成恢复扫描） |
| `apps/server/src/report.ts` | +`extractTouchedFiles(repoPath, baselineSha, headSha)`：`git diff --name-only`（rename 显示路径），与 commit 提取同源 execGit 通道 |
| `apps/server/src/routes/tickets.ts` | submitSpec body 扩 plannedFiles（parse）；列表/详情响应自然透出 |
| `apps/server/src/routes/types.ts` | 契约扩：TicketListItem/TicketDetail +queuedReason/queuedAt/retryCount/retryAt/plannedFiles；SubmitSpecBody +plannedFiles? |
| `apps/server/test/helpers.ts` | fake worker/上下文工厂扩双并行 spawn 支持（两单各自 fake worker 实例与断言钩子——r1-m1） |
| `apps/server/test/ticket-service.test.ts` | +：plannedFiles 冻结与 JSON 往返/闸门排队两通道分流+worker_id 早绑定/文件冲突 422 与 system 排队/pendingLabel 参数化/queued 清空与 onInflightReleased 触发（DISPATCHED→CANCELLED、BLOCKED→CANCELLED、abort→FAILED 三边）/双集合口径/reopen 与 reassign 不入队 |
| `apps/server/test/file-set.test.ts`（新） | 匹配边界：前缀/嵌套/根路径/尾斜杠/未声明跳过 |
| `apps/server/test/dispatcher.test.ts` | B6 更新（立即重试→倒计时：注入 now 断言 retry_at/pendingLabel='agent'）；+：闸门排队 FIFO 恢复/**饥饿免疫四路径**（前单 DONE/超时 FAILED/崩溃 FAILED/preSpawnFail CANCELLED 各起一排队单，断言均被唤醒——对应四挂载点）/user 边释放（DISPATCHED→CANCELLED 回调路径）/退避 60-120-240 与同态升级 l3（blockReason 摘要+system comment，断言无 transitions 行）/重启恢复（RETRY_WAIT 到期+排队重校验）/实测预警（T1 未声明 DONE 落 a.ts vs T2 声明含 a.ts → 双留言）/两单并行真跑互不干扰（双 fake worker：worktree/分支/commit 隔离） |
| `apps/server/test/api.test.ts`（或新增 api-s3.test.ts） | +：FILE_SET_CONFLICT 422 details 结构/放行排队响应（ticket.queuedReason+workerId 早绑定可查）/新字段透出/submitSpec plannedFiles 校验 |

**块 1 最小验证**：`pnpm -F @atd/server exec tsc --noEmit && pnpm -F @atd/server test`

### 块 2：web（UI 与契约手抄）

| 文件 | 改动 |
|---|---|
| `apps/web/src/api/types.ts` | 手抄契约同步（对齐块 1 routes/types.ts 增量，逐字段） |
| `apps/web/src/api/tickets.ts` | submitSpec 参数扩 plannedFiles |
| `apps/web/src/components/QueuedTag.tsx`（新） | 排队徽标：GATE_QUEUED/FILE_CONFLICT 文案+排队时刻 |
| `apps/web/src/pages/WorkbenchPage.tsx` | 待处理区：排队单（queuedReason 非空）显示 QueuedTag、隐藏放行按钮；「阻塞与待裁决」区按 pendingLabel 分流——l3 走既有 BlockedResolutionCard；agent（RETRY_WAIT）只读卡：重试次数/下次唤醒倒计时（useNow） |
| `apps/web/src/pages/TicketListPage.tsx` | BLOCKED 行 pendingLabel 徽标；SPEC_READY 排队行 QueuedTag |
| `apps/web/src/pages/TicketDetailPage.tsx` | +排队信息展示（原因/时刻）；BLOCKED agent 态只读重试信息（次数/retryAt 倒计时），不渲染裁决卡 |

**块 2 最小验证**：`pnpm -F @atd/web build`

## API 契约冻结（块 2 并行依据）

- 放行 `POST /api/tickets/:id/transition` 响应不变（`{ticket}`）；排队判定=`ticket.status==='SPEC_READY' && ticket.queuedReason`；user 通道闸门满同此（不报错）
- 新错误码 `FILE_SET_CONFLICT`（422）：`{error: {code, message, details: ['单 N 与单 M 文件集相交: a.ts, dir/', ...]}}`
- TicketListItem/TicketDetail 新字段：`queuedReason: 'GATE_QUEUED'|'FILE_CONFLICT'|null`、`queuedAt: number|null`、`retryCount: number`、`retryAt: number|null`、`plannedFiles: string[]|null`
- `POST /api/tickets/:id/spec` body：`{specContent, plannedFiles?: string[]}`

## 技术决策

- **D1 排队承载=独立列**（queued_reason/queued_at）+ worker_id 早绑定；不复用 blockReason（queue=放行前等待、blockReason=执行中受阻）
- **D2 回调通道为新建**：`TicketService` 构造注入 `onInflightReleased`，app.ts 装配接线到 dispatcher.releaseAndRecheck——r1 核实现状无此通道（onTicketSettled 为 Dispatcher 内部方法仅 DONE 分支调用），本 Story 装配面改动即 app.ts/index.ts 进块 1 清单的依据
- **D3 tick=dispatcher 内 setInterval**，opts 注入 `tickIntervalMs`/`now()`（测试 seam），AppRuntime 挂载/清除；不引 cron 依赖
- **D4 snapshot 修复步骤**（判据先行）：① `pnpm -F @atd/server exec drizzle-kit generate --name s3_parallel` 首跑——预期因 meta 止于 0002 而 journal 已到 0003 报错或生成含 block_reason 重复列的脏 0004 ② 手工补 `meta/0003_snapshot.json`：以 0002_snapshot 为基，tickets 表增 `block_reason` 列定义（0003 SQL 的全部 DDL 变更仅此一项；六表 DELETE 的数据清理不涉 schema）③ 重跑 generate——**判据：0004 SQL 仅含 S3 变更（5 列+1 表），无 block_reason/0003 重复项** ④ `drizzle-kit migrate` 后既有测试全绿为最终判据；超时 fallback：手写 0004 SQL+手工 0004 snapshot（generate 校验通过为验收）
- **D5 retryOnReportMiss 兼容**：schema 留 optional 位读到即 warn 忽略；config.yaml 删键
- **D6 退避口径**：`retry_count` 进入 RETRY_WAIT 时递增（首次=1），间隔=`min(retryBackoffSec × 2^(retry_count-1), 240)`；升级判定 `retry_count >= maxRetries`（默认 3 → 60/120/240 三次后升级）；continue/reassign/reopen 清零
- **D7 通道分流复用既有机制**：不新增 channel opt——S2w1 的 user/system 区分（repoRef 复校分流同源，自动放行链调用点显式标 system）既有实现为本依据；transition 签名现状为准，r2 审查核对该载体真实存在
- **D8 校验作用域**：仅 SPEC_READY→DISPATCHED 新放行边；reopen/resolveTicket 恢复语义直执行（见技术方案 2）

## 依赖

- 块 2 依赖本文件「API 契约冻结」节（先行冻结，不依赖块 1 代码完成）
- D4 依赖 drizzle-kit 环境可用（仓内既有 db:generate script）

## 风险

| 风险 | 缓解 |
|---|---|
| settle/回调链复杂度 | releaseAndRecheck 单一实现 + 饥饿免疫四路径+三 user 边释放全量用例（挂载点与用例一一对应） |
| drizzle snapshot 修复不确定性 | D4 判据先行 + fallback 手写路径 |
| B6 等既有用例语义更新波及 | dispatcher.test.ts 改动逐条列出，review 对照 |
| reopen/reassign 绕闸的瞬时超闸 | MVP 接受（恢复语义优先；闸门目的是防新放行洪峰，非硬 invariant），记档 |
| transition 签名/装配面改动波及 | D2/D7 均为新增可选注入与复用既有标志，既有调用零语义变化；tsc 全量把关 |
