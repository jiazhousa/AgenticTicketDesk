# 审查报告: atd-s3-parallel-retry spec (Revision 1)

- **审查类型**：Spec 轻量审查（S-S5 维度：Epic 覆盖 / 内部一致性 / 可实现性 / 契约完备性 / 边界与风险）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s3-parallel-retry/spec.md`（v2，69 行，四项澄清已落定）
- **上位基准**：Epic `agentic-ticket-desk` §4.2 卡点路由与 pending 闭环 / §5 状态机 / §9 S3 行（验收三条）/ §13 风险
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（只读核对：`dispatcher.ts` / `domain/status.ts` / `domain/ticket-service.ts` / `domain/errors.ts` / `config.ts` + `config.yaml` / `db/schema.ts` / `drizzle/` / `report.ts` / `routes/tickets.ts` / web `types.ts` + `WorkbenchPage.tsx`）
- **日期**：2026-09-25

## 总体评价

[不通过]

方向与结构正确：并行执行落为「合并期治理」而非「执行期治理」的立论成立（MUST-1 worktree 隔离为事实前提），双层防线（可选声明前置 + 实测交叉预警）与 Epic §9 S3 三条验收的映射（验收 9 自陈 1/4/3）准确，v2 无 v1 硬校验残留，四项澄清（依赖等待维持 SPEC_READY / preSpawnFail 不重试 / plannedFiles 双防线 / 退避 60-120-240）均有头部拍板记录，主要挂载点（BLOCKED→DISPATCHED 出边、settle 判定链、基线 diff）与代码现状对得上。但存在 **2 处阻塞核心验收落地的设计空洞**（pending:agent 进入边未声明、排队唤醒触发面只覆盖 DONE——后者使 spec 自陈的「无饥饿」论证被代码事实直接证伪），另有 3 处契约缺口（plannedFiles 持久化载体、重试配置取代关系、pending:l3 占位口径）。建议 rev2 收口 F-1/F-2/M-1 后快速复审。

## 分数

**53 / 100**（100 − 2×high12 − 3×medium5 − 4×low2）

必改项：F-1、F-2、M-1；M-2/M-3 建议同轮修订；L 项随 rev2 一并收口。

## 发现的问题

### F-1（high）pending:agent 的**进入边**在状态机中不存在，验收 3 按字面无法落地

- **位置**：范围「`BLOCKED(pending:agent)` 引擎：进入原因三类（GATE_QUEUED/FILE_CONFLICT/RETRY_WAIT）」（行 23）；业务规则 2、4；验收 2、3
- **描述**：三类进入原因的起点不同——RETRY_WAIT 自 IN_PROGRESS 进入（`IN_PROGRESS: ['DONE','BLOCKED','FAILED']`，边存在），但 **GATE_QUEUED/FILE_CONFLICT 发生在放行前置阶段**：工单此时处于 SPEC_READY，闸门满/声明相交后需落 BLOCKED(pending:agent)。核对 `status.ts:22-32`：`DISPATCHED: ['IN_PROGRESS','CANCELLED']`、`SPEC_READY: ['DISPATCHED','CANCELLED']`——**无 DISPATCHED→BLOCKED，亦无 SPEC_READY→BLOCKED**。同时 `ticket-service.ts:475` 对 `to==='BLOCKED'` 硬编码 `pendingLabel='l3'`，且 pendingLabel/blockReason 的语义定义绑在 BLOCKED 态（`schema.ts:28-31`）。Epic §5 括注（行 141）亦把 BLOCKED 入边全集限定为「IN_PROGRESS → BLOCKED」，故新增进入边是非平凡的状态机扩展。
- **影响**：验收 3「`maxConcurrentPerRepo=1` 下第二单排队 pending:agent(GATE_QUEUED)」与验收 2 的 system 通道排队，若无新边则只能退化为「保持 SPEC_READY 挂起」或「停在 DISPATCHED 打标签」——两种都与「BLOCKED 子标签 + 转出走 BLOCKED→DISPATCHED」的设计自相矛盾，impl 期必然自行发明状态语义。AGENTS.md 明确「边表 `TRANSITIONS` + `isUserEdge` 双定义，改动必须同步两侧」，spec 未声明任何边表改动。
- **建议**：在范围/业务规则显式声明新增 **DISPATCHED→BLOCKED（system 边）**（放行先落 DISPATCHED，闸门/文件集判定不通过即 system 转入 BLOCKED(pending:agent)），并注明 `isUserEdge` 不同步开放（保持 system 专属）；同时把「该边是对 Epic §5『BLOCKED 入边全集』的扩展」补入头部澄清记录。若采用此形态，验收 3 应写明中间态（放行成功 → 立即排队）。

### F-2（high）排队唤醒触发面只覆盖 DONE，前单 FAILED/CANCELLED 时排队单永久挂起——与规则 3 的「无饥饿」论证矛盾

- **位置**：业务规则 3（行 53「前单必有 settle 落定——超时兜底保证无饥饿」）；关键风险表（行 68「DONE 后要跑：自动放行+排队唤醒+实测比对」）；验收 3、6
- **描述**：代码事实——唯一的落定钩子 `onTicketSettled` **只在 DONE 分支调用**（`dispatcher.ts:267`）；超时→FAILED（`:222-230`）、崩溃→FAILED（`:231-242`）、报告缺失耗尽→BLOCKED（`:296-307`）、preSpawnFail→CANCELLED/FAILED（`:311-333`）**均无钩子调用**；`recoverOnStartup`（`:452-481`）只处理 DISPATCHED/IN_PROGRESS，且 BLOCKED 单在重启后原样保留。
- **影响**：`maxConcurrentPerRepo=1` 下 T2 GATE_QUEUED，T1 崩溃/超时→FAILED（本 Story 明确「不做分类重试」，FAILED 即终态）——槽位已释放，但无任何事件唤醒 T2，T2 永久挂在 BLOCKED(pending:agent)，直到重启才由启动扫描捞起。规则 3 的论证恰在此失效：「超时兜底」的终点就是 FAILED，而 FAILED 不触发钩子。这与 Epic §4.2 的不变量「不存在永远无人理会的卡点」冲突，且验收 3 的措辞「第一单 **settle** 后 FIFO 自动恢复」未把 settle 限定为 DONE——builder 按 DONE-only 实现即可通过该验收而留下空洞。
- **建议**：二选一并写死——①唤醒触发面 = 任一落定（DONE/FAILED/CANCELLED/转出 BLOCKED），即把钩子调用点从 DONE 分支提升到判定表所有终态出口；②（推荐，改动面更小且天然覆盖全路径）5s 周期扫描同责排队复检（业务规则 9 的扫描器统一处理「retry_at 到期 + 排队单复检」）。验收补一条「前单 FAILED/CANCELLED 后，排队单仍被唤醒并按 FIFO 复检」。

### M-1（medium）plannedFiles 的持久化载体缺失，前置校验无从查询

- **位置**：范围行 19（「submitSpec 请求体可选字段…随快照冻结」）+ 行 26（migration 0004 清单）；业务规则 1、2；验收 2
- **描述**：migration 0004 清单仅列 `retry_count`、`retry_at`、排队原因承载与 `ticket_files`；`tickets` 表现无声明列（`schema.ts:9-37`），submitSpec 契约现为 `{ specContent }`（`routes/tickets.ts:57`、`:125`，`ticket-service.ts:377`）。业务规则 2 要求「与 in-flight 集内**已声明单**两两相交检测」＝按 workspace+repoRef 查询在途单的声明集合；「随快照冻结」未指明载体，而 specContent 是自由文本不可解析。
- **影响**：声明集不落库则该 Story 的核心校验（验收 2）无数据源；若 impl 自选载体（JSON 列/独立表），契约冻结口后移且与 web 侧透出字段脱节。
- **建议**：0004 清单补 `tickets.planned_files`（JSON text，存声明原文+原始相对路径）；业务规则 1 写明「落库于 tickets.planned_files；SPEC_READY 后不可改（DRAFT 期经 updateTicket/submitSpec 修改）」，并同步 API 透出定义。

### M-2（medium）新配置位 `maxRetries` 与既有 `retryOnReportMiss` 的取代/兼容关系未定义，且范围配置清单不全

- **位置**：范围行 22（config 位仅写 `maxConcurrentPerRepo`）；验收 4（`maxRetries` 默认 3 可配）；验收 8（零回归）
- **描述**：现实现为 `config.retryOnReportMiss`（`config.ts:22` 默认 1，`config.yaml:9` 显式 1），判定在 `dispatcher.ts:297`（`ctx.round <= retryOnReportMiss`）；既有测试 `helpers.ts:167`、`dispatcher.test.ts:262-281`（B6：报告缺失→L2 重试→BLOCKED）依赖该语义。S3 的 RETRY_WAIT + 指数退避 + `maxRetries` 显然是对同一机制的改造，但 spec 未说明：maxRetries 与 retryOnReportMiss 是取代（弃用旧键+yaml 迁移）还是并存（谁优先）、重试次数计法与 round 的关系。
- **影响**：impl 面对同义两个配置键无从选择；`config.yaml` 变更（新增/删除键）未列入范围，属配置契约不完整；验收 8「fence 全绿」若被读作「既有用例原样通过」，会与 B6 的**有意**语义变更冲突（立即重试 → 60s 退避后重试）。
- **建议**：范围配置清单补 `maxRetries`（默认 3）并写明与 `retryOnReportMiss` 的取代关系（推荐：以 maxRetries 取代，旧键保留解析但标注 deprecated，yaml 注释同步）；验收 8 增注「既有 L2 用例（B6 等）随语义改造更新断言，属有意变更而非回归」。

### M-3（medium）`pending:l3` 是否占位，三处口径互相矛盾

- **位置**：范围行 20（in-flight 集 = 「DISPATCHED/IN_PROGRESS/pending:agent 排队」）vs 业务规则 3（行 53「前单 BLOCKED 等人裁决时排队单随之等待，裁决后自然解锁」）vs 业务规则 4（行 54 闸门计数 = 「DISPATCHED+IN_PROGRESS」）
- **描述**：按范围与规则 4，前单转 BLOCKED(pending:l3) 后既不计入闸门槽位、也不在文件集 in-flight 集内 → 排队单唤醒复检应通过并立即放行；而规则 3 断言会「随之等待」。两种行为相反，同一 spec 内并存。
- **影响**：验收 2/3 中排队单在前单转 l3 卡点后的行为不可判定（等待 vs 立即恢复执行），impl 与质量门各取一读法即产生互斥结论。
- **建议**：写死口径。推荐「BLOCKED(pending:l3) 不占闸门槽位、不计入文件集 in-flight 集」（前单已停跑，无执行期风险；且人工裁决可能久拖，占位会放大饥饿面），并据此删改规则 3 该句；若坚持占位，则需在规则 4 与范围 in-flight 集定义里补入 BLOCKED。

### L-1（low）头部澄清记录未覆盖两项对 Epic 的偏离

- **位置**：行 7（四项澄清）vs 范围「不做」行 35（worktree 池化移出）与验收 2（system 通道相交由「拒」改「排队」）
- **描述**：Epic §9 S3 行明列交付「worktree 池」，spec 以「allocate 复用 S2a 已有」移出范围（理由成立），但无用户拍板记录；Epic §9 S3 验收① 字面为「文件集相交**被拒**」，spec 在 system（编排链）通道改为「排队」，同为语义收紧/偏离，亦未记录。
- **建议**：并入头部澄清记录（⑤⑥「worktree 池化不做」「user 通道拒/system 通道排队」），避免后续质量门按 Epic 字面判不符。

### L-2（low）排队原因字段名留白至 impl，且 web 手抄契约同步义务未记档

- **位置**：范围行 26（「排队原因承载…impl 定」）、业务规则 7（「承载位置 impl 定」）；验收 7
- **描述**：验收 7 要求 UI 展示原因 tag/次数/倒计时，业务规则 7 要求 API 详情透出 pendingLabel/retryCount/retryAt/原因——但「原因」的字段名与取值域未定，前端无契约可依；`types.ts:73-74` 已预告「S3 扩 'agent'」，且该文件头部明确「手抄同步自 server（契约变更两侧同步）」，spec 未记该同步义务。
- **建议**：spec 定死字段名与类型（如 `queuedReason: 'GATE_QUEUED'|'FILE_CONFLICT'|'RETRY_WAIT'|null`、`retryCount: number`、`retryAt: number|null`），业务规则补「server 契约 + web types.ts 手抄同步（含待定值的 pendingLabel 枚举收敛为 'l3'|'agent'）」。

### L-3（low）migration 0004 落点未处理 drizzle journal/snapshot 既有不同步

- **位置**：范围行 26（「DB migration 0004」）
- **描述**：`drizzle/meta/_journal.json` 有 4 entry（0000–0003），但 `drizzle/meta/` 仅 0000–0002 snapshot；`0003_s2w1_blocker_inline.sql` 为手写（DELETE 清理 + `ALTER TABLE ... ADD COLUMN block_reason`），无对应 snapshot。drizzle-kit generate 会以 0002 snapshot 为基线出 0004，重放 0003 已覆盖的差异（脏 SQL）。
- **建议**：范围 0004 条补一句实施纪律（手写 0004 SQL + 补齐 0003/0004 snapshot，把该既有不同步在本 Story 一并收口），或明示留给 impl 并在 impl 审查时核。

### L-4（low）`maxConcurrentPerRepo` 配置形态未定

- **位置**：范围行 22
- **描述**：「per-repo」只给单一默认值 2，未说明是全局标量（对每个仓统一生效）还是按 workspace+repoRef 的映射（可逐仓覆盖）；验收 3 仅覆盖标量 =1 的形态。
- **建议**：写死为标量全局默认（若有逐仓覆盖需求，另立后续 Issue/在配置注释中说明）。

## 观测（不计分，供 impl 参考）

1. **「不引入 cron 依赖」的论据落点**（业务规则 9）：Epic §7 已规划 server 侧 node-cron（S4 审计），措辞容易被误读为架构约束；论据宜落在「5s 粒度非 cron 适用」。
2. **实测比对仅 DONE 触发**（规则 6）：FAILED 前若已产生 commit（崩溃于 commit 后），实测清单不入 `ticket_files`，预警缺一面。与「不做 DONE 间合并检测」不冲突、属可接受取舍；建议 impl 至少在 FAILED 时也落实测清单备查（非阻塞）。
3. **Epic §9 S3 行的陈旧措辞**：Epic 仍写「超限自动升级 BLOCKER」，spec 采用内联 `BLOCKED(pending:l3)` 正确（Epic v4 §3/§5 已内联化），建议后续 Epic 修订时同步 §9。
4. **恢复通道 actor**：pending:agent 自动恢复走 BLOCKED→DISPATCHED（`status.ts:27` 有边），须以 `actor='system'` 调用（该边不在 `isUserEdge` TASK 白名单内，`status.ts:41-57`）——spec 未写，impl 自明。
5. **system 通道「重走放行前置链」的范围**：现 `transition()` 的 TASK 放行四件套**仅 user 通道**执行（`ticket-service.ts:450`，注释 `:448-449` 明确 system 通道刻意跳过 repoRef 复校/worktree 前置）。spec 说恢复「重走放行前置链」，impl 需明确复跑的是「依赖门 + 闸门 + 文件集」，而非四件套全量，避免与既有分流设计冲突。

## 核查通过项（不计分）

1. **可实现性锚点对得上**：BLOCKED→DISPATCHED 出边存在（`status.ts:27`）；放行前置链有单点挂载（`ticket-service.ts:434` 依赖门 + `:450` guards 注入）；基线 diff 复用可行（`dispatcher.ts:100` `worktree.baseline` + `report.ts:44-49` `git log <baseline>..HEAD`，扩 `--name-only` 变体直接可用）；settle 判定链已在单方法内（`dispatcher.ts:210-308`），「统一收敛到 onTicketSettled 单入口」方向可行（但见 F-2 触发面）。
2. **Epic 覆盖**：§9 S3 三条验收 → spec 验收 1/4/3 映射准确（验收 9 自陈一致）；两处显式收紧（依赖等待维持 SPEC_READY、preSpawnFail 不纳入重试）在头部澄清记录 ①② 有用户拍板支撑。
3. **验收可溯源**：验收 1←规则 1/2、2←规则 2/8、3←规则 2/4、4←规则 5/9、5←规则 5/6、6←规则 9、7←规则 7、8←范围/零回归——除 F-2 缺口外无孤立验收；「不做」清单与业务规则无实质矛盾（仅 L-1 两项偏离待补记）。
4. **双层防线论证成立**：L1 声明前置拦截「已声明的相交」、L2 实测兜底捕捉「误声明/未声明」并在 settle 后预警，二者独立生效；与「合并是人工动作、ATD 不管理合并」的边界清晰。
5. **零回归面已识别**：未声明单不受校验影响、`pendingLabel='l3'` 存量行为不变，与 `state-machine-s2a.test.ts:35-40`、`api-s2a.test.ts:125-131` 的既有断言兼容。

## 结论

# REJECT

状态：SPEC_DRAFT → SPEC_DRAFT（REJECT；F-1/F-2/M-1 为必改项，rev2 修订后可快速复审）

> **状态机异常（需调度者处置）**：Spec 审查的「审查前状态」应为 `SPEC_REVIEWING`（07-state-machine.md §审查者状态转移表），但 `stage_get('atd-s3-parallel-retry')` 返回 `SPEC_DRAFT`，`.stage-history` 仅有一条建档记录（`null → SPEC_DRAFT`，调度者）——调度者派发本次审查前未置 `SPEC_REVIEWING`。审查者侧 `stage_set` 实测被拒（`错误：非法转移：SPEC_DRAFT → SPEC_DRAFT`，合法后继仅 `SPEC_REVIEWING`），故未执行状态变更。因本轮结论为 REJECT、目标态 `SPEC_DRAFT` 与当前态一致，**净效果正确**；但审计链缺失一行「审查者 REJECT 落定」留痕。建议调度者：后续派发任一审查前先按职责分工置 `*_REVIEWING`；本轮若需补全留痕，可先置 `SPEC_REVIEWING` 再由审查者回落（或在 rev2 审查时一并补齐）。
>
> 注：仅审文档，未修改 spec 正文、未触碰任何业务代码；`.stage` 未变更（原因见上）。
