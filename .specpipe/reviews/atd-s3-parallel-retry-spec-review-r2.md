# 审查报告: atd-s3-parallel-retry spec (Revision 2)

- **审查类型**：Spec 轻量审查（r2 复审；维度：r1 发现闭合核验 / Epic 覆盖 / 内部一致性 / 契约完备性 / 可实现性 / 边界与风险）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s3-parallel-retry/spec.md`（v3，77 行）
- **基准材料**：r1 报告 `.specpipe/reviews/atd-s3-parallel-retry-spec-review-r1.md`；Epic `agentic-ticket-desk/epic-spec.md` §4.2/§5/§9
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（只读核对：`domain/status.ts` / `domain/ticket-service.ts` / `domain/errors.ts` / `dispatcher.ts` / `config.ts` + `config.yaml` / `db/schema.ts` / `routes/tickets.ts` / web `api/types.ts` + `WorkbenchPage.tsx`）
- **日期**：2026-09-25

## 总体评价

[通过]

r1 的 2 high + 3 medium + 4 low **全部闭合或实质闭合**，且闭合方式经代码事实交叉核对成立：

- **F-1（状态机空洞）**：v3 放弃「排队进 BLOCKED」，改为 **SPEC_READY + `queued_reason`/`queued_at` 元数据**承载，并显式声明「状态机零新增边」（范围「不做」第 6 条）；`pending:agent` 收缩为仅 RETRY_WAIT，走既有 `IN_PROGRESS→BLOCKED`（`status.ts:26`）与 `BLOCKED→DISPATCHED`（`status.ts:27`）。三处（范围「不做」6 / 业务规则 3/6 / 验收 2/3）措辞一致，且「排队═放行前、BLOCKED═执行中受阻」的分层在背景段（行 18）与偏离清单 2 有立论。核验通过。
- **F-2（唤醒触发面）**：业务规则 5 已把触发面提升为「**任何离开 {DISPATCHED, IN_PROGRESS} 的转移** + 启动恢复扫描」，并对齐代码实际出口全集——`TRANSITIONS[DISPATCHED]=['IN_PROGRESS','CANCELLED']`、`TRANSITIONS[IN_PROGRESS]=['DONE','BLOCKED','FAILED']`，离开集为 `CANCELLED/DONE/BLOCKED/FAILED` 四类，恰与验收 4 四路径（超时 FAILED / 崩溃 FAILED / preSpawnFail CANCELLED / 卡点 BLOCKED）吻合；启动恢复对 BLOCKED（RETRY_WAIT）单不误伤（`recoverOnStartup` 只处理 DISPATCHED/IN_PROGRESS，`dispatcher.ts:452-481`）。核验通过。
- **M-1/M-2/M-3**：`planned_files` 已入 0004 清单（行 31）与业务规则 9 API 透出；`retryOnReportMiss` 显式废弃（启动忽略+告警，范围行 32 / 风险表末行）；闸门计数集 vs 文件集占用集的双集合定义已单点写死（业务规则 2）并被范围行 25/28、规则 3/7 一致引用；B6 语义变更在验收 9 精确化。核验通过。
- **L-1~L-4**：偏离清单 4 条齐备、排队字段名定死（`queuedReason/queuedAt/retryCount/retryAt/plannedFiles`）、drizzle meta snapshot 风险入表、`maxConcurrentPerRepo` 形态隐含标量。核验通过。

**残余问题**：关闭 r1 全部阻塞项后，v3 **未引入新的 high/critical**，但复查发现 **1 处 medium 契约口径缺口**（闸门满时 user 通道行为未定义，范围行 28 与业务规则 3 括注口径冲突）与 **4 处 low**（交叉引用漂移、plannedFiles DRAFT 期修改入口、「DRAFT 重提可改」措辞、排队字段清空时机、偏离清单两处遗漏）。均为文档精度级，不阻塞进入用户审计；建议在 impl 任务书前置澄清（尤其中-1），或随 Epic 修订一并收口。

**附加核验点结论**：
- 排队单（SPEC_READY+`queuedReason`）与依赖等待（SPEC_READY，`queuedReason=null`）**字段层面可区分**（规则 9 透出），UI 层面以「原因徽标」区隔基本成立（验收 8）；但「排队单是否仍显示放行按钮 / 点击语义」未声明，其行为依赖中-1 的闸门 user 通道口径。
- 验收 10 对 Epic §9 S3 三条验收的覆盖**声明成立**（①→验收 1/2、②→验收 5、③→验收 3），仅 §9②「升级 BLOCKER」字面与 v3「升级 BLOCKED(pending:l3)」不一致（Epic §9 陈旧措辞），见低-4。

## 分数

**87 / 100**（100 − 1×medium5 − 4×low2）

## 审查报告：r1 发现闭合核验表

| r1 项 | 严重度 | v3 修订锚点 | 结论 |
|---|---|---|---|
| F-1 pending:agent 进入边不存在 | high | 范围「不做」6（零新增边）/ 规则 3、6 / 验收 2、3；偏离清单 2 | **已闭合**（改为 SPEC_READY 元数据承载，与 r1 建议的 DISPATCHED→BLOCKED 方案不同但成立且改动面更小） |
| F-2 唤醒面只覆盖 DONE | high | 规则 5（任何离开 {DISPATCHED, IN_PROGRESS}）/ 验收 4 四路径 / 风险表钩子行 | **已闭合**（触发面 = 代码实际离开边全集） |
| M-1 plannedFiles 无载体 | medium | 范围行 24 / 0004 清单行 31 / 规则 9 | **已闭合**（残余 low 见低-2/低-3） |
| M-2 retryOnReportMiss 取代关系 | medium | 范围行 32（显式废弃+告警）/ 风险表末行 / 验收 9 | **已闭合**（配置清单三键齐备；`config.yaml` 键的注释同步未提，非阻塞） |
| M-3 闸门/in-flight 口径矛盾 | medium | 规则 2 双集合定义 / 范围行 25/28 / 规则 3/7 | **已闭合**（采纳「BLOCKED 不占闸门、计文件集」口径，与 r1 推荐略异但自洽且立论充分） |
| L-1 头部偏离清单缺 2 项 | low | 头部偏离清单 1–4（含 worktree 池化、system 排队） | **已闭合**（见低-4：仍余 2 处未记） |
| L-2 排队字段名留白 | low | 规则 9 定死字段 / 规则 10 手抄义务 / 规则 6 pendingLabel='agent' | **已闭合** |
| L-3 drizzle snapshot 不同步 | low | 风险表 snapshot 行（impl 决策项+任务书携带） | **已闭合** |
| L-4 maxConcurrentPerRepo 形态 | low | 范围行 28/32（单一默认值 2） | **已闭合（隐含标量）**；建议 impl 任务书一句点明 |

## 发现的问题（r2 新增/残余）

### 中-1（medium）闸门满时 **user 通道**行为未定义，范围行 28 与业务规则 3 口径冲突

- **位置**：范围行 28（「同仓闸门计数集达限即排队」无通道限定）vs 业务规则 3（「进入（放行时闸门满/文件冲突**且 system 通道**）」）vs 验收 3（闸门排队，未标通道）
- **代码事实**：user 通道放行存在且为常规路径（`status.ts:46` `SPEC_READY→DISPATCHED` 在 TASK user 白名单；`routes/tickets.ts` `/transition`；`WorkbenchPage.tsx:222-225` 待处理区对 TASK SPEC_READY 直接给「放行」按钮）。`errors.ts` 错误码全集仅 18 个，**无闸门相关错误码**。
- **描述**：按范围行 28 字面，闸门满「即排队」，对 user 通道同样成立；按规则 3 括注，排队两因（闸门满/文件冲突）仅适用 system 通道——则 user 通道闸门满的行为既非排队、也无专属错误码，属未定义。两处口径互斥，验收 3 的「第二单排队」若由 user 手动放行触发则与规则 3 直接冲突。
- **影响**：impl 面对「用户点放行且同仓在跑数达上限」时必须自行发明语义（静默排队 or 报错 or 直接放行绕过闸门），质量门可各取一读法判不符；若选择新增错误码则构成未声明契约变更。附带影响：排队单保持 SPEC_READY，user 边合法，用户在待处理区对排队单再点「放行」的行为同样落入此未定义区。
- **建议**：二选一写死——①（推荐，与范围行 28/验收 3 最省改动）**闸门满时 user 通道亦排队**：放行请求不报错，工单保持 SPEC_READY + `queued_reason=GATE_QUEUED`，删去规则 3 括注中的「闸门满」限定或改写为「文件冲突仅 system 通道排队」；② 明确 user 通道闸门满返回固定错误码（需同步 `errors.ts` 封闭 union 与规则 8）。同时补充「排队单（`queuedReason` 非空）的放行按钮呈现/点击语义」。

### 低-1（low）范围行 25 交叉引用漂移（「见业务规则 4」应为「业务规则 2」）

- **位置**：范围行 25「与同 repo **文件集占用集**（见业务规则 4）中已声明单两两相交检测」
- **描述**：v3 修订后「两个集合」的定义落在业务规则 **2**（行 58）；业务规则 **4**（行 60）为「排队不计入 retryCount」。交叉引用未随修订更新，指向错误。
- **影响**：读者按引用跳转落空，impl/质量门定位双集合定义需二次检索。
- **建议**：改为「（见业务规则 2）」。

### 低-2（low）plannedFiles 的 DRAFT 期修改入口缺失，「DRAFT 重提可改」措辞与 submitSpec 语义不符

- **位置**：范围行 24「submitSpec 请求体扩为 `{specContent, plannedFiles?}`；…随快照冻结（DRAFT 重提可改，SPEC_READY 后不可）」
- **代码事实**：`submitSpec` **仅 DRAFT 可调**且为一次性（`ticket-service.ts:381-383`，非 DRAFT 报 `NOT_DRAFT`），无「重提」路径；`updateTicket`/`patchBody` **不含 plannedFiles**（`ticket-service.ts:350`、`routes/tickets.ts:50-55`），仅 title/description/specContent 且限 DRAFT。
- **描述**：若 plannedFiles 仅在 submitSpec 时写入，则 DRAFT 期无独立修改入口；「DRAFT 重提可改」在代码语义上不可能发生（提交即冻结转态，不能二次 submit）。r1-M1 建议的「DRAFT 期经 updateTicket/submitSpec 修改」只兑现了后者。
- **影响**：声明集在 DRAFT 期的编辑路径不完整；若 impl 需支持「先建单后补声明」，会自造 PATCH 字段（契约未声明）。
- **建议**：措辞改为「DRAFT 期经 `PATCH /api/tickets/:id`（patchBody 增 `plannedFiles`）或 `submitSpec` 写入」并同步范围契约；或明示「plannedFiles 仅 submitSpec 时确定，DRAFT 期不可独立编辑」。

### 低-3（low）排队字段（`queued_reason`/`queued_at`）的清空时机未声明

- **位置**：范围行 26 / 规则 3 / 规则 9
- **描述**：排队单保持 SPEC_READY，无状态转移可挂靠清空。规则 3 只写「仍不满足则重新排队（保持原 `queued_at`）」，未写放行成功（转 DISPATCHED）、user 取消（SPEC_READY→CANCELLED）或终端态时 `queued_reason/queued_at` 是否置 NULL。规则 9 无条件透出两字段，存在「已 DISPATCHED/已取消仍显示排队原因」的残留风险。
- **影响**：详情/列表页展示可能残留陈旧排队徽标；API 契约对「何时为 null」无定义。
- **建议**：规则 3 补一句生命周期：「转出 SPEC_READY（放行成功/取消）时 `queued_reason`/`queued_at` 置 NULL」。

### 低-4（low）偏离清单与验收 10 仍遗漏两处对 Epic 的偏离/措辞差

- **位置**：头部偏离清单（4 条）vs Epic §5 行 132/行 141 与 §9 S3 验收②
- **描述**：
  1. **恢复目标态**：Epic §4.2 行 68 / §5 行 132 写 `BLOCKED(pending:agent) ─条件满足──→ IN_PROGRESS`；v3 规则 6 为 `BLOCKED→DISPATCHED` 重 spawn（round+1）。代码锚点：既有裁决 continue 走 `BLOCKED→IN_PROGRESS`（`dispatcher.ts:364`）、reassign 走 `BLOCKED→DISPATCHED`（`:368`），v3 取后者路线，属对 Epic §5 的语义偏离，未记。
  2. **§9② 字面**：Epic §9 S3 验收② 写「pending:agent 超限自动升级 **BLOCKER**」；v3 验收 5 为「自动升级 `BLOCKED(pending:l3)`」（合 Epic §4.2/§5 内联化口径，§9 为陈旧措辞）。验收 10 的覆盖声明未就此加注。
- **影响**：质量门若按 Epic §5/§9 字面逐条比对，可能判「实现与上位文档不符」；审计链缺少这两条偏离的显式留痕（r1-L1 同族问题的残留）。
- **建议**：偏离清单补第 5 条「pending:agent 恢复目标态取 DISPATCHED（与裁决 continue 的 IN_PROGRESS 并存，理由：复用 spawn 链）」；验收 10 或偏离清单对 §9②「BLOCKER」加脚注「按 §4.2/§5 内联化口径为 BLOCKED(pending:l3)，Epic §9 措辞待修订」。

## 观测（不计分，供 impl 参考）

1. **唤醒钩子挂载层**：规则 5 要求覆盖「任何离开 {DISPATCHED, IN_PROGRESS} 的转移」，但挂载点提示为「`onTicketSettled` 扩展为全路径 + BLOCKED 转移钩子」——`onTicketSettled` 在 dispatcher 层，而 user 通道 `DISPATCHED→CANCELLED` 经路由直调 `service.transition`（`ticket-service.ts:409`），不经 dispatcher。建议 impl 把重校验钩子落在 `service.transition` 出口（或对 user 通道取消边单独补挂），否则「任何」不成立，user 手动取消前单时排队单会漏唤醒。
2. **验收 4 四路径未含 user 手动取消 DISPATCHED**：规则 5 的「任何」已覆盖，验收 4 仅枚举四例（非穷举措辞）。若采纳观测 1 的钩子层建议，建议验收 4 补「user 取消 DISPATCHED 前单」一例，避免 builder 只挂 dispatcher 路径。
3. **Queue 字段与「待处理」计数**：`WorkbenchPage.tsx:199` 待处理 Badge = drafts + SPEC_READY 全量。排队单保持 SPEC_READY 会抬高「待处理」计数，而 system 排队单本不需用户动作——建议 impl 在 UI 上把排队单与真正待放行单视觉分离（不属阻塞本 Story 的 spec 缺项，属实现取向）。
4. **`retryOnReportMiss` 的 yaml 注释同步**：范围行 32 只说启动忽略+告警，未提 `config.yaml:9` 该键的注释/删除处理；r1-M2 曾建议 yaml 注释同步，建议 impl 一并处理（不 fail 语义已定，属文档一致性）。
5. **F-2 修复与既有测试**：`dispatcher.test.ts` 现有「超时/崩溃→FAILED 不触发下游」类断言，若 onTicketSettled 扩为全路径，需核查这些用例是否隐含「FAILED 无钩子」假设（与 B6 同属有意语义变更，建议在验收 9 的「变动清单」口径内逐条列出）。

## 核查通过项（不计分）

1. **状态机零新增边可行**：`SPEC_READY + queued_*` 承载排队不需任何 `TRANSITIONS` 改动；`pending:agent` 的进入/恢复（`IN_PROGRESS→BLOCKED` / `BLOCKED→DISPATCHED`）均已在边表（`status.ts:26-27`）；`isUserEdge` 无需同步开放（恢复走 `actor='system'`，`dispatcher.ts` 既有模式）。r1-F1 的「边表+isUserEdge 双定义」风险归零。
2. **plannedFiles 载体可实现**：`tickets` 表加列 + `submitSpec` 契约扩字段 + 手抄 `types.ts` 同步，路径清晰；匹配函数「声明vs声明 / 实测vs声明」双向复用为单实现，可测。
3. **双层防线论证仍成立**：L1 声明前置（user 422 / system 排队）、L2 实测兜底（DONE settle 比对 `ticket_files`），与「合并为人工动作、ATD 不管理合并」边界清晰。
4. **Epic 覆盖**：§9 S3 三条（并行互不干扰/文件集相交被拒、pending:agent 超限升级、闸门限流可配）→ 验收 1+2 / 5 / 3，验收 10 映射成立（措辞差见低-4）；§4.2 的三进入条件（重试倒计时/等待依赖/资源不足）在 v3 拆为 RETRY_WAIT（pending:agent）+ 依赖/资源（SPEC_READY 排队），偏离清单 1/2 记录在案。
5. **可实现性锚点**：闸门计数与文件集占用可基于 `tickets.status` + `repoRef` 聚合查询；重启恢复不误伤 BLOCKED（`recoverOnStartup` 过滤 `inArray(status, ['DISPATCHED','IN_PROGRESS'])`）；FIFO 位由 `queued_at` 保持。
6. **零回归面**：无 plannedFiles/无排队单行为与契约不变（验收 9）；`pendingLabel` 由硬编码 'l3' 参数化后 user 通道语义不变（`ticket-service.ts:475` 现逻辑仅在 `to==='BLOCKED'` 分支）。

## 结论

# PASS

状态：SPEC_REVIEWING → SPEC_USER_AUDIT

> r1 全部阻塞项（F-1/F-2/M-1）及 M-2/M-3、L-1~L-3 已闭合。残余 1 medium（中-1）+ 4 low（低-1~低-4）为文档精度级，建议在 impl 任务书前置澄清中-1 的两处口径，并可随 Epic §5/§9 修订一并收口低-4。未修改 spec 正文与任何业务代码。
