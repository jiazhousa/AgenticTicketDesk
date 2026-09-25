# Impl: S3 并行执行与排队/自愈引擎

- **topic**：atd-s3-parallel-retry
- **上游 spec**：`.specpipe/plans/atd-s3-parallel-retry/spec.md`（v3.1，SPEC_APPROVED）
- **基线**：main@8456548

## 技术方案

总体策略：server 侧一次成块（引擎强耦合，不拆）、web 侧独立成块（契约冻结先行）——两块文件集不相交可并行派发。

**核心机制落点**：

1. **排队不走状态机**：闸门满（两通道）/文件冲突（仅 system 通道）→ 工单保持 SPEC_READY，落 `queued_reason`/`queued_at`；放行 API 返回 `{ticket}`（前端按 `ticket.queuedReason` 判「已排队」）
2. **双集合查询**：`闸门计数集` = 同 repo（workspace+repoRef）DISPATCHED+IN_PROGRESS；`文件集占用集` = 前者 + SPEC_READY 排队中 + BLOCKED（任何 pendingLabel，非终态保留声明）
3. **唤醒单入口**：`releaseAndRecheck()`——任何离开 {DISPATCHED, IN_PROGRESS} 的转移（settle 三终态 + 入 BLOCKED）与启动恢复扫描统一调用；内部对同 repo 排队单按 queued_at FIFO 重走完整放行前置链（闸门+文件集复校验），满足则 DISPATCHED+spawn，否则保持排队
4. **RETRY_WAIT 引擎**：报告缺失/schema 错 → IN_PROGRESS→BLOCKED(pendingLabel='agent') + retry_at；dispatcher 5s tick 扫到期单 → BLOCKED→DISPATCHED 重 spawn（round+1）；`retry_count` 达 `maxRetries` → 留 BLOCKED 改 pendingLabel='l3' + blockReason 记历次失败摘要（升级即卡点，人裁决三选恢复）
5. **实测防线**：DONE settle 提取基线 diff 文件清单（与 commit 提取同源）落 `ticket_files`，与占用集声明单交叉比对，相交 → 两单各落 system 留言预警（不改状态）

## 改动点

### 块 1：server（引擎全量）

| 文件 | 改动 |
|---|---|
| `apps/server/src/db/schema.ts` | tickets +`retry_count`（integer NOT NULL DEFAULT 0）+`retry_at`（integer 可空）+`planned_files`（text 可空，JSON 数列）+`queued_reason`（text 可空）+`queued_at`（integer 可空）；新表 `ticketFiles`（`ticket_files`：ticketId/round/path，UNIQUE(ticket_id, round, path)） |
| `apps/server/drizzle/0004_s3_parallel.sql` + `meta/` | migration 0004 + snapshot 链修复（见技术决策 D4）+ journal entry |
| `apps/server/src/config.ts` | +`maxConcurrentPerRepo`（缺省 2）/`maxRetries`（缺省 3）/`retryBackoffSec`（缺省 60）；`retryOnReportMiss` 保留 optional 读取位——存在即 `console.warn` 忽略（D5） |
| `config.yaml` | +3 新键；删 `retryOnReportMiss` 行 |
| `apps/server/src/domain/errors.ts` | +`FILE_SET_CONFLICT`（422，details 含双方单号+相交文件） |
| `apps/server/src/domain/file-set.ts`（新） | 匹配函数单一实现：精确路径+目录前缀（`dir/` 尾斜杠递归包含）；`intersects(a, b)` / `matchSet(paths, declared)`；供前置校验与实测预警双向复用 |
| `apps/server/src/domain/ticket-service.ts` | ① submitSpec body 扩 `plannedFiles?: string[]`（zod：相对路径/尾斜杠目录语义；空数组视同未声明），落 `planned_files` ② transition 的 TASK→DISPATCHED 放行前置插双校验：闸门满→两通道一律落 queued 字段返回（不转移状态）；文件冲突→user 通道抛 FILE_SET_CONFLICT、system 通道落 queued(FILE_CONFLICT)——system 通道经既有 `autoDispatch` 标志区分（transition opts 增 `channel: 'user'\|'system'`，缺省 user）③ transition opts 增 `pendingLabel?`（仅 IN_PROGRESS→BLOCKED 边生效，缺省 'l3'——现硬编码处参数化，user 通道行为不变）④ DISPATCHED/CANCELLED 转移时清空 queued 两字段 ⑤ 双集合查询函数（gateCount/occupancySet）⑥ TicketListItem/TicketDetail 增 5 字段透出 |
| `apps/server/src/dispatcher.ts` | ① `releaseAndRecheck()` 单入口（见技术方案 3；挂载：onTicketSettled 既有收敛点尾部 + service 层 BLOCKED 转移回调 + 启动扫描）② 报告缺失/schema 错路径改 RETRY_WAIT 流程（技术方案 4；`retry_at = now + min(retryBackoffSec × 2^retry_count, 240)`，retry_count 随每次进入递增，恢复 spawn 时不清零、升级或人裁决后清零）③ 5s tick（AppRuntime 挂载/清除；到期恢复经完整放行前置链，spawn 失败走既有 preSpawnFail→CANCELLED）④ settle DONE：调 report.ts 新函数提取实测文件落 ticket_files + 对占用集声明单交叉预警（system 留言，模板含对方单号+相交文件）⑤ recoverOnStartup 扩：RETRY_WAIT 单重建计时（已到期立即恢复）+ 排队单重校验一轮 |
| `apps/server/src/report.ts` | +`extractTouchedFiles(repoPath, baselineSha, headSha)`：`git diff --name-only <baseline> <head>`（rename 显示路径），与 commit 提取同源 execGit 通道 |
| `apps/server/src/routes/tickets.ts` | submitSpec body 扩 plannedFiles（parse）；列表/详情响应自然透出（service 层已扩） |
| `apps/server/src/routes/types.ts` | 契约扩：TicketListItem/TicketDetail +queuedReason/queuedAt/retryCount/retryAt/plannedFiles；SubmitSpecBody +plannedFiles? |
| `apps/server/test/ticket-service.test.ts` | +：plannedFiles 冻结与 DRAFT 编辑语义/闸门排队两通道分流/文件冲突 422 与 system 排队/pendingLabel 参数化/queued 字段清空时机/双集合口径 |
| `apps/server/test/file-set.test.ts`（新） | 匹配边界：前缀/嵌套/根路径/尾斜杠/未声明跳过 |
| `apps/server/test/dispatcher.test.ts` | B6 更新（立即重试→倒计时，断言 retry_at/pendingLabel='agent'）；+：闸门排队 FIFO 恢复/饥饿免疫四路径（前单 DONE、超时 FAILED、崩溃 FAILED、入 BLOCKED 各起一排队单）/退避 60-120-240 与升级 l3（blockReason 摘要）/重启恢复（RETRY_WAIT 到期+排队重校验）/实测预警（T1 未声明 DONE 落 a.ts vs T2 声明含 a.ts → 双留言）/两单并行真跑互不干扰（双 fake worker 断言 worktree/分支/commit 隔离） |
| `apps/server/test/api.test.ts`（或新增 api-s3.test.ts） | +：FILE_SET_CONFLICT 422 details 结构/放行排队响应（ticket.queuedReason）/新字段透出/submitSpec plannedFiles 校验 |

**块 1 最小验证**：`pnpm -F @atd/server exec tsc --noEmit && pnpm -F @atd/server test`

### 块 2：web（UI 与契约手抄）

| 文件 | 改动 |
|---|---|
| `apps/web/src/api/types.ts` | 手抄契约同步（对齐块 1 的 routes/types.ts 增量，逐字段） |
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

- **D1 排队承载=独立列**（queued_reason/queued_at），不复用 blockReason——queue=放行前等待、blockReason=执行中受阻，语义分离且 UI 分区依据清晰
- **D2 唤醒挂载**：service 层 BLOCKED 转移回调经 AppRuntime 既有装配通道（onTicketSettled 同款）通知 dispatcher；启动恢复复用 releaseAndRecheck——单一实现三处复用
- **D3 tick=dispatcher 内 setInterval(5s)**，不引 cron 依赖；AppRuntime 挂载/清除
- **D4 drizzle snapshot 修复**：generate 0004 前先补 0003 期 snapshot（journal 有 entry 而 meta 止于 0002）；以 `drizzle-kit generate` 实测为准，冲突则手工校正 journal——探针步骤，若两小时内无法收敛则 fallback：手写 0004 SQL + 手工 snapshot（以最终 generate 校验通过为验收）
- **D5 retryOnReportMiss 兼容**：schema 留 optional 位，读到即 warn 忽略；config.yaml 删键
- **D6 退避口径**：`retry_count` 进入 RETRY_WAIT 时递增（首次=1），间隔=`min(backoff×2^(retry_count-1), 240)`；升级判定 `retry_count >= maxRetries`（maxRetries=3 → 60/120/240 三次后升级）；人裁决 continue/reassign 或 reopen 后 retry_count 清零
- **D7 channel 区分**：transition opts `channel` 缺省 'user'；既有自动放行链调用点显式传 'system'（`onTicketSettled` 内）；两通道共用同一校验函数，仅冲突处理分流

## 依赖

- 块 2 依赖本文件「API 契约冻结」节（先行冻结，不依赖块 1 代码完成）
- D4 依赖 drizzle-kit 环境可用（仓内既有 db:generate script）

## 风险

| 风险 | 缓解 |
|---|---|
| settle/BLOCKED 钩子链复杂度 | releaseAndRecheck 单入口 + 饥饿免疫四路径 + 重启恢复全量用例 |
| drizzle snapshot 修复不确定性 | D4 探针步骤 + fallback 手写路径 |
| B6 等既有用例语义更新波及 | dispatcher.test.ts 改动逐条列出（见改动点），review 对照 |
| transition 签名变化（opts 扩展）波及调用面 | channel/pendingLabel 均缺省兼容，既有调用零改动；tsc 全量把关 |
