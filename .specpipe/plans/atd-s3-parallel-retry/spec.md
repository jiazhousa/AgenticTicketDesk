# Spec: S3 并行执行与排队/自愈引擎

- **topic**：atd-s3-parallel-retry
- **状态**：v3.1（r2 审查 PASS 87 残余闭合：闸门 user 通道口径/交叉引用/冻结时机/清空时机/偏离补录；待用户放行）
- **日期**：2026-09-25（v1 草案 / v2 澄清收敛 / v3 r1 修订）
- **上游**：Epic `agentic-ticket-desk` §4.2/§9；S2a/S2w1 已交付
- **澄清记录**（2026-09-25 用户拍板）：① 依赖等待维持 SPEC_READY（对 Epic §4.2 显式收紧）② preSpawnFail 维持 CANCELLED 不纳入重试 ③ plannedFiles「可选声明+实测兜底」双防线 ④ 指数退避 60/120/240
- **对 Epic 的偏离清单**（终稿放行后随 Epic 修订同步，涉及 §4.2/§5/§9）：
  1. 依赖等待不进 pending:agent（澄清①）
  2. 资源排队（闸门）与文件冲突排队以 **SPEC_READY + queue 元数据**承载，不进 BLOCKED（r1-F1 修订：与偏离 1 同族——「未放行等待」与「执行中受阻」分离；pending:agent 仅 RETRY_WAIT 使用，状态机零新增边）
  3. system 通道（编排链自动放行）文件集相交从「被拒」改为「排队」（user 通道仍 422 拒绝，与 Epic §9 验收一致）
  4. worktree 预建池化裁剪（allocate 复用 S2a 已有）
  5. Epic §5 pending:agent 恢复边为 →IN_PROGRESS，本 spec 为 →DISPATCHED（恢复=重走放行链重新 spawn）
  6. Epic §9 S2a/S3 行「升级 BLOCKER」为内联化前陈旧措辞（现语义=BLOCKED(pending:l3)；Epic 该两处待随修订同步）

## 背景

S2a/S2w1 交付了单发执行闭环。当前缺口：多单同时放行无治理（同仓并发 git 操作无闸门、文件集无校验）；L2 重试是立即原地 round+1，无倒计时/上限升级；Epic §4.2 的 pending:agent 自愈闭环未落地。

并行冲突的本质是**合并期问题而非执行期问题**（MUST-1 worktree 物理隔离保证执行互不干扰），文件集治理采用两层防线：可选的声明前置校验 + settle 实测交叉预警。排队与等待统一为「放行前」概念，与「执行中受阻」（BLOCKED）分离。

## 范围

**做**：

- `plannedFiles` 可选声明：submitSpec 请求体扩为 `{specContent, plannedFiles?}`；落 `tickets.planned_files`（TEXT，JSON 数列，可空）；随 submitSpec 提交冻结（与 specContent 同一入口同一时机；DRAFT 期可反复编辑不涉冻结，SPEC_READY 后不可改）
- 前置校验（声明 vs 声明）：放行时与同 repo **文件集占用集**（见业务规则 2）中已声明单两两相交检测；user 通道 422 FILE_SET_CONFLICT；system 通道排队
- 排队承载：`tickets.queued_reason`（TEXT：GATE_QUEUED / FILE_CONFLICT）+ `queued_at`（INTEGER epoch）；工单保持 SPEC_READY，不入 BLOCKED
- settle 实测防线：DONE settle 从基线 diff 提取实际改动文件落 `ticket_files` 表；与文件集占用集中单的声明集交叉比对，相交 → 双方 system 留言预警（不改状态不阻塞）
- 并发闸门：per-repo `maxConcurrentPerRepo`（config.yaml，默认 2）——同仓**闸门计数集**达限即排队（FIFO 按 queued_at；**两通道一律排队**，user 放行不报错、单入队）
- `BLOCKED(pending:agent)` 自愈引擎（仅 RETRY_WAIT）：进入/倒计时/恢复/上限升级 l3；重启恢复
- 卡点与排队 UI：工作台「待处理」区显示排队单（原因徽标+排队时刻）；「阻塞与待裁决」区 BLOCKED 分 pending:l3（裁决三选）/ pending:agent-RETRY_WAIT（只读：次数/下次唤醒倒计时）；列表页徽标区分
- DB migration 0004：`tickets` +`retry_count`（INTEGER NOT NULL DEFAULT 0）+`retry_at`（INTEGER 可空）+`planned_files`（TEXT 可空）+`queued_reason`（TEXT 可空）+`queued_at`（INTEGER 可空）；新表 `ticket_files`（ticket_id, round, path，UNIQUE(ticket_id, round, path)）
- 配置：`maxConcurrentPerRepo`（默认 2）/ `maxRetries`（默认 3）/ `retryBackoffSec`（基数 60，60×2^retryCount 封顶 240）；**`retryOnReportMiss` 废弃**（启动遇旧键忽略并告警，行为由 maxRetries+退避取代）

**不做**：

- DONE 单之间的合并冲突检测（合并是人工动作，git 冲突标记天然暴露；ATD 不管理合并）
- 在途单执行中途回收/中断（相交只预警不强停）
- 崩溃/超时重试与 preSpawnFail 分类重试（维持 FAILED/CANCELLED 终态；后续 Issue）
- plannedFiles glob/通配匹配（精确路径+目录前缀）
- 状态机新增转移边（零新增——排队不走 BLOCKED，RETRY_WAIT 用既有 IN_PROGRESS→BLOCKED / BLOCKED→DISPATCHED）

## 验收标准（终版）

1. **并行隔离**：两 TASK（声明不相交 plannedFiles）同时放行真跑，worktree/分支/日志/commit 互不干扰
2. **声明相交拒绝**：同仓两单声明相交 → user 放行 422 FILE_SET_CONFLICT（details 含双方单号+相交文件）；编排链自动放行 → 后者保持 SPEC_READY 排队（queued_reason=FILE_CONFLICT），前者落定后自动放行执行
3. **闸门限流**：`maxConcurrentPerRepo=1` 下第二单排队（queued_reason=GATE_QUEUED），第一单 settle 后 FIFO 自动恢复
4. **饥饿免疫**：前单超时 FAILED / 崩溃 FAILED / preSpawnFail CANCELLED / 卡点 BLOCKED 四种离开执行态的路径均触发排队重校验——排队单不因前单非 DONE 而挂起
5. **重试自愈**：报告缺失 → BLOCKED(pending:agent, RETRY_WAIT) 带 retry_at；到点自动 round+1；连续失败按 60/120/240 退避，达 `maxRetries` → 自动升级 BLOCKED(pending:l3)，blockReason 含历次失败摘要
6. **实测预警**：T1 未声明跑完（实测改 `a.ts`），T2 在途已声明含 `a.ts` → T1 settle 时两单各收到 system 预警留言；状态不变
7. **重启恢复**：RETRY_WAIT 在途单重启后计时器重建、到点恢复（已到期立即恢复）；排队单由启动扫描重校验一轮
8. **UI 分区**：待处理区排队单（原因+时刻）/ 裁决区 l3 卡 / 只读 RETRY_WAIT 卡（次数+倒计时，无裁决按钮）三者呈现正确；列表页徽标区分
9. **回归口径**：无 plannedFiles/无排队的存量路径行为与 API 契约不变；既有测试套件全绿，其中 B6 重试时序用例随新语义更新（立即重试→退避倒计时，改动在 impl 逐条列出）；fence 全绿
10. Epic §9 S3 验收三条分别被 1/5/3 覆盖（"文件集相交被拒"按偏离 3 口径：user 拒绝+system 排队）

## 业务规则

1. **plannedFiles 语义**：相对 repoRef 路径；`dir/` 尾斜杠=递归包含；空数组视同未声明；匹配函数单一实现双向复用（声明 vs 声明、实测 vs 声明）
2. **两个集合**：**闸门计数集** = 同 repo 的 DISPATCHED+IN_PROGRESS（排队与 BLOCKED 不占闸门——未在执行）；**文件集占用集** = 同 repo 的 DISPATCHED+IN_PROGRESS+SPEC_READY 排队中+BLOCKED（非终态都保留其声明占用，防卡点单恢复后与后来者冲突）
3. **排队生命周期**：进入（闸门满——两通道一律；文件冲突——仅 system 通道排队，user 通道 422 拒绝）→ 挂起（SPEC_READY + queued_reason/queued_at，放行请求不报错）→ 唤醒（触发面见规则 5）→ 重走完整放行前置链（闸门+文件集复校验），仍不满足则重新排队（保持原 queued_at 维持 FIFO 位）；排队字段在成功放行（DISPATCHED）或取消（CANCELLED）时清空；UI 待处理区对排队单不显示放行按钮、显示排队徽标（原因+时刻）
4. **排队不计入 retryCount**（retryCount 仅 RETRY_WAIT 自愈失败计数）；排队无上限——占用集单必经终态或 BLOCKED，BLOCKED 经人裁决必回执行或终态，无环
5. **唤醒触发面（单入口收敛）**：任何离开 {DISPATCHED, IN_PROGRESS} 的转移（settle 三终态 + 入 BLOCKED）与 server 启动恢复扫描，统一触发队列重校验；实现挂载点 `onTicketSettled` 扩展为全路径 + BLOCKED 转移钩子
6. **RETRY_WAIT 引擎**：报告缺失/schema 错 → IN_PROGRESS→BLOCKED（pendingLabel='agent'——`ticket-service.ts` 现硬编码 'l3' 处参数化，user 通道语义不变）；retry_at=now+60×2^retry_count（封顶 240）；到点 BLOCKED→DISPATCHED 重 spawn（round+1）；retry_count 达 maxRetries → 留 BLOCKED 改 pendingLabel='l3' + blockReason 记录历次摘要；周期扫描 5s tick，幂等
7. **实测清单口径**：与 commit 提取同源（merge-base..HEAD `--name-only`，rename 取显示路径）；仅 DONE settle 落库比对；比对对象=文件集占用集单的声明集（未声明跳过）
8. **错误码**：FILE_SET_CONFLICT 入 errors.ts 封闭 union（422）
9. **API 透出**：详情/列表增 queuedReason/queuedAt/retryCount/retryAt/plannedFiles（读）；web 手抄契约 `apps/web/src/api/types.ts` 同步义务入 impl 任务块
10. **web 契约与 UI**：手抄 types.ts + 页面改动归 web 任务块；排队/卡点/预警三类呈现见验收 8

## 关键风险

| 风险 | 缓解 |
|---|---|
| 声明质量依赖 spec 作者 | S2b2 编排 agent 拆单可强制声明；人工单靠实测防线兜底；两层防线独立生效 |
| 匹配口径不一致（前缀/嵌套/根路径） | 匹配函数单实现双向复用 + 边界单测锁定 |
| 排队唤醒风暴（多单同时醒来挤闸门） | 唤醒即重走完整前置链，超限自然重排；FIFO 位保持 |
| settle/BLOCKED 钩子链复杂度上升 | 单入口顺序执行（settle 三终态+BLOCKED 转移+启动扫描共用一个重校验函数），全路径单测 |
| drizzle meta snapshot 落后 journal（0003 无 snapshot） | impl 决策项：generate 0004 前先补齐 0003 期 snapshot（或 journal 校正），防 generate 冲突——任务书显式携带 |
| retryOnReportMiss 废弃的存量配置兼容 | 启动遇旧键：忽略+日志告警（不 fail） |
