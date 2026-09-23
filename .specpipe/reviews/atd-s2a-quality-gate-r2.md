# 质量门审查报告: atd-s2a-worker-loop (Revision 2)

> 复审判定：r1 REJECT（70/100）的修复闭合复审。修复 commit `26fc263`（9 文件）+ 测试锚点同步 `7b82f75`。

- 类型：Story 质量门全面审查（S-S10 终检 · 二轮 / r2）
- 对象：worktree `/home/starlex/project/AgenticTicketDesk-s2a`，分支 `dev/feat/atd-s2a-worker-loop` @ `7b82f75`（`git status` 干净，复跑后再次确认）
- 基准：spec v4（主仓 @ `0b22ebb` + 工作区 2 行未提交）、impl v3（同）；r1 报告 `atd-s2a-quality-gate-r1.md`
- 状态校验：实测 `.stage` = `WORKING`，与质量门「审查前状态 = `QUALITY_GATE`」**不一致**（r1 REJECT 落 `WORKING` 后，调度者的「重新递交」跳 `WORKING→QUALITY_GATE` 缺失）——按《07-state-machine》§状态规则「审查前状态不一致则中止并提示调度者」，**本报告不写 `.stage`**，落定办法见「状态落定」节
- 日期：2026-09-23

## 总体评价

**通过**（技术结论成立）。r1 的 1 处 high 核心已根治、2 处 medium 中 #2/#3 实质闭合、#4 闭合（含归档效力残余）；遗留 2 处 medium 级残余/深层问题与 3 处 low 级残余，均不阻塞质量门判定。

## 质量评分

**84 / 100**

| 严重度 | 条数 | 单扣 | 小计 |
|---|---|---|---|
| critical | 0 | -25 | 0 |
| high | 0 | -12 | 0 |
| medium | 2 | -5 | -10 |
| low | 3 | -2 | -6 |

扣分项：A（medium）/ B（medium）/ C、D、E（low），见「发现的问题」。

## fence 结果

- 说明：项目 `{wf}/fence.sh`（`/home/starlex/project/AgenticTicketDesk-s2a/.specpipe/fence.sh`）为四包实脚本（install + 三包 tsc + 三包 test + web build）；脚本本体不在检查者命令白名单（`./x.sh` 形态被拒），按 r1 同款**逐条独立复跑**（同一 worktree、未改任何文件）：
- 单元测试：`@atd/worker-core` 7 用例，7 通过，0 失败，0 跳过（~1.0s）
- 单元测试：`@atd/worker-opencode` 9 用例，9 通过，0 失败，0 跳过（~0.8s）
- 单元测试：`@atd/server` 100 用例，100 通过，0 失败，0 跳过（8 文件，3.46s；较 r1 的 98 增 2 = 新用例 nonexistent-cmd + IN_PROGRESS/blocks 正例；含 S1 基线 46）
- E2E 测试：无（本项目无 E2E 基建；真实链路以 B1 真跑 + 临时 git 仓 spawn 用例覆盖）
- 合计：**116 用例，116 通过，0 失败，0 跳过**
- 类型检查：`@atd/worker-core` / `@atd/worker-opencode` / `@atd/server` 三包 `tsc --noEmit` 零错误；`@atd/web build`（内部含 `tsc --noEmit`）→ vite 构建通过（3049 模块，仅 antd 单包 >500kB 常规提示）
- 依赖一致性：`pnpm install --frozen-lockfile` → `Lockfile is up to date`（749ms，5 workspace 项目）
- B1/B9 实证材料：`~/.local/share/atd/logs/` 下 t7 等工件在盘（t7.r1.raw/events + atd/t7 终局由 r1 逐条核验，材料有效；本轮未重跑真机）

## r1 问题闭合核对表

| # | r1 问题（severity） | 声称修复 | 核验结论 | 证据锚点 |
|---|---|---|---|---|
| 1 | execution 语义跨块背离（high） | 详情 execution 仅 DISPATCHED/IN_PROGRESS 返回；测试改 DONE=null + IN_PROGRESS 正例 | **部分闭合**：终态/阻塞态不再携带 → DONE 单误显「执行中」与 5s 轮询 + finish 触发的自刷新循环根治；**残余 BLOCKER/STORY 伪执行卡**（见问题 A） | `routes/tickets.ts:93-99`；`api-s2a.test.ts:108-122`；`WorkerCard.tsx:48/82-84/132-137`；`TicketDetailPage.tsx:132` |
| 2 | spawn 发起失败走 FAILED（medium） | startRun 后 pid 空检查 → preSpawnFail（CANCELLED+留言）；用例 nonexistent-cmd | **实现层闭合**：时序正确（pid 检查在 `IN_PROGRESS` 转移**之前**）；CANCELLED + 留言；用例真实命中（waitStatus CANCELLED + 留言断言）。**深层矛盾**：CANCELLED 无出边，「可重新放行」不可兑现（见问题 B） | `dispatcher.ts:114-141`（检查）vs `143-149`（进位）；`264-287`（preSpawnFail）；`execution.ts:170`（`child.pid ?? -1`）、`146-167`（error 异步 settle，不 reject 无悬挂异常）；`dispatcher.test.ts:197-204` |
| 3 | BLOCKER 父单死路径（medium） | TicketDetail 加 `blocks` 反查 + 前端 BlockerCard 接 `blocks[0]` | **闭合**：反查方向正确（`blockedByTicketId=本单` → join `ticketId` 取被阻塞方 = 父单）；前端接线正确；测试断言方向正确 | `ticket-service.ts:226-234/286`；`TicketDetailPage.tsx:77/166`；`api-s2a.test.ts:123-128`；`BlockerCard.tsx:97-103` |
| 4 | 实证修订未回写（medium） | spec §3.1 / §6-MUST-2 与 impl §0 / §4 对齐 standalone/allow；LEGAL fixture 同构 | **闭合（内容）**：四处全部对齐（主仓 `0b22ebb` + 工作区 2 行）；LEGAL fixture 注释「与预置 opencode.yaml 同构」已成立。**遗留归档效力**（见问题 E） | 主仓 `spec.md:40/161`、`impl.md:18/83`；`workers/opencode.yaml:7`；`profile.test.ts:4-12` |
| 5 | defaultTimeoutMin 死配置（low） | profile.timeoutMin optional + dispatcher 回退 config | **闭合**：schema 放宽（`.optional()`）+ `?? this.deps.config.defaultTimeoutMin` 接线；config.yaml/config.ts/app.ts 注释一致；无专属断言（观察项 O2） | `profile.ts:18`；`dispatcher.ts:108-110`；`config.ts:15-16`；`config.yaml:6-7` |
| 6 | finish 语义文档偏差（low） | —（未修） | **未闭合**：spec §3.2/§3.7 仍写「stdout 无 finish → 失败」，实现为退出码 0 恒补记 finish（该分支仅随退出码非 0 可达）——双口径未消 | `spec.md:64/116` vs `execution.ts:123-128`、`dispatcher.ts:188-208` |
| 7 | UnifiedEvent 镜像宽松（low） | —（未加注记） | **未闭合**：server `routes/types.ts:43` 把 `reason?` 挂 4 类联合（worker-core 仅 turn-end 有）且无动机注记；web 侧既有「UI 消费最小集」注记未变 | `routes/types.ts:41-46`；web `api/types.ts:135-146` |
| 8 | repoPath 护栏注释（low，r1 明示不扣分） | —（未办） | **未办**：config.yaml/README 未补「自吃场景保持 ATD 工作区干净」句；维持 r1「不扣分」口径（观察项 O1） | `config.yaml:1-3`；`README.md`（无） |

## 特别核对项（任务书指定）

1. **execution 门控是否真正覆盖 DISPATCHED 态语义** —— 覆盖：`activeExec = status ∈ {DISPATCHED, IN_PROGRESS}` ∧ 存在 IN_PROGRESS 转入记录（`routes/tickets.ts:94-95`）。逐态推演：首轮 DISPATCHED（无历史转入）→ null（spawn 在途毫秒级窗口，展示「未在执行」可接受）；L2 重试/裁决继续（状态保持 IN_PROGRESS，bumpRound）→ 非 null（running 正确）；改派（BLOCKED→DISPATCHED→IN_PROGRESS）→ 非 null；BLOCKED/BLOCKER/DONE/FAILED/CANCELLED → null（循环与误报根治）。**唯一缺口**：门控未含类型/轮次维度 → BLOCKER 单（创建即 IN_PROGRESS + 落 DRAFT→IN_PROGRESS 转移）与 STORY 人工 IN_PROGRESS 仍为假阳性（问题 A）。
2. **spawn pid 检查时序** —— 正确：`startRun` 同步返回 `pid = child.pid ?? -1`（ENOENT 时 pid 为 undefined → -1，error 事件异步）→ `run.pid <= 0` 判定在 `service.transition(...,'IN_PROGRESS')` **之前**（`dispatcher.ts:138-141` 先于 `144-148`）；失败处置走 `preSpawnFail`（DISPATCHED→CANCELLED + 留言）。error 分支的 `done` promise 只 resolve 不 reject（`execution.ts:146-167`），早退无悬挂 rejection；raw 末行仍落 `spawnError` 审计留痕。
3. **blocks 反查方向** —— 正确：依赖行语义 `(ticketId=被阻塞方, blockedByTicketId=阻塞方)`；BLOCKER 单详情取 `blockedByTicketId = 本单 id` 的行、join 出 `ticketId` 侧 = 父单（`ticket-service.ts:226-234`），与 `resolveBlocker` 定位父单同口径（`dispatcher.ts:306-315`）；前端 `blocks[0]?.id` → BlockerCard「阻塞父单 #N」链接（`BlockerCard.tsx:97-103`）。

## 发现的问题

### A. BLOCKER/STORY 详情页仍伪「执行中」+ 伪「执行」卡（r1#1 残余）—— 严重程度：medium

- 事实：门控只按状态。BLOCKER 单由 `createBlocker` 置 `IN_PROGRESS` 且落 `DRAFT→IN_PROGRESS` 转移（`ticket-service.ts:462-488`）；STORY 人工边可达 IN_PROGRESS（`status.ts:41`）——两者 `execution` 均非 null。前端 WorkerCard 渲染门 `(ticket.workerId != null || detail.execution != null)` 未含类型维度（`TicketDetailPage.tsx:132`），`running = execution != null`（`WorkerCard.tsx:48`）→ 渲染「执行」卡并显示橙色「执行中」（`:132-137`）。
- 影响：卡点裁决页（BLOCKER 详情，卡点处理主入口）与 STORY 详情页**永久**显示虚假「执行中」状态 + 无意义的「执行」卡（worker「（未知）」/轮次 0）。无功能/数据影响；round=0 → `hasRound=false` 无 /logs 轮询，无循环——纯状态误导，但属 r1 标题明列的未闭合面。
- 建议：WorkerCard 渲染门收口为 `ticket.type === 'TASK' && (ticket.workerId != null || ticket.round >= 1)`（r1 建议 b 原案），或 `running` 判据加 `ticket.type === 'TASK'`；同步 `apps/web/src/api/types.ts:89` 注释。

### B. pre-spawn 失败落 CANCELLED，但 CANCELLED 为终态——「可重新放行」承诺不可兑现 —— 严重程度：medium

- 事实：实现忠实对齐 spec §4（`dispatcher.ts:264-287` ↔ `spec.md:142`：DISPATCHED→CANCELLED + system 留言「派发失败：<原因>，可重新放行」）；但状态机 `TRANSITIONS.CANCELLED = []`（`status.ts:29`），TASK user 边白名单无 CANCELLED 出边（`status.ts:40-51`），前端终态明确「无出边，不渲染按钮」（`TransitionActions.tsx:15`）。Epic §5 口径：FAILED「不设自动恢复；补救=人工重开新工单」（`epic-spec.md:124`），CANCELLED 同为汇点。
- 影响：r1#2 的核心诉求（恢复路径）**未实质达成**——单仍卡死终态（与 FAILED 实际效果等同，仅标签不同），且系统留言向用户承诺了一个不存在的能力（用户按提示修复配置后找不到「重新放行」的任何入口）。spec §4 与 Epic §5 / 自身 §3.5 边表自相矛盾。
- 建议（需调度者/用户裁决，二选一）：① 补 `CANCELLED→DISPATCHED`（或 DISPATCHED→SPEC_READY 回退）边兑现「可重新放行」（注意与「人为取消」语义区分）；② 维持终态口径，改 spec §4 + 留言文案为「已取消（终态）：如需重试请新建工单」，消除假承诺。

### C. finish 语义文档双口径未消（r1#6 残余）—— 严重程度：low

- 事实：spec §3.2 `:64` 与 §3.7 `:116` 仍写「退出码非 0 / stdout 无 finish → 失败」，实现为退出码 0 恒补记 `finish(success=true)`（`execution.ts:123-128`），`settle()` 只判 `timedOut`/`exitCode`（`dispatcher.ts:188-208`）——「stdout 无 finish」分支实际不可独立达。
- 建议：按 r1 原建议改写 §3.7 该行（「退出码非 0 → FAILED；退出码 0 而报告缺失/格式错 → L2 重试」），或恢复 `hadFinish` 判定用途并补用例——二选一，不留双口径。

### D. UnifiedEvent 镜像宽松未加注记（r1#7 残余）—— 严重程度：low

- 事实：server `routes/types.ts:43` 仍把 `reason?: string` 挂在 `turn-start | turn-end | text-start | text-end` 联合上（worker-core 仅 `turn-end` 携带）；未添加「有意宽松」的动机注记。web 侧 `api/types.ts:135-146` 宽松化本身有「字段按 UI 消费最小集」注记（该注记 r1 时已存在，本轮未变）。
- 建议：镜像收窄为与 `events.ts` 逐字同构（或抽 `@atd/worker-core` 类型依赖）；如维持宽松，在 server 侧写明动机。

### E. 文档回写归档效力（r1#4 残余）—— 严重程度：low

- 事实：回写落在**主仓 main 分支** `0b22ebb`（spec §6-MUST-2 / impl §4）+ **工作区 2 行未提交**（spec §3.1 `:40`、impl §0 `:18`）；交付分支 `dev/feat/atd-s2a-worker-loop` 的 `.specpipe/plans/atd-s2a-worker-loop/` 副本仍为 `0dd8b48` 旧版（命令仍 `--dir`、权限仍 `ask`）——r1#4 所述「照旧文档改 profile 会复现 r1-r5 失败链」的风险在交付分支内未消除；2 行未提交有丢失风险。另：`26fc263` commit message 含「spec/impl 模板与权限文案对齐实交付」但文件清单未含文档改动（工作在 commit 外完成）。
- 建议：提交 2 行并将 `0b22ebb` 同步（cherry-pick / 文档以主仓为准的显式约定）到交付分支，避免 S2b/S3 消费旧副本。

## 非扣分观察项

- **O1** repoPath 护栏注释未加（config.yaml 仅「默认指向本仓自身（开发期自吃）」，README 无「自吃场景保持 ATD 工作区干净」句）——维持 r1 明示口径不扣分；建议随文档收尾补一句。
- **O2** `defaultTimeoutMin` 回退无专属用例（逻辑一行、接线正确）；可选补 raw meta `timeoutMs = config 默认 × 60000` 断言。
- **O3** r1#4 建议的「spec §6-MUST-1『运行期失败走 FAILED』与 §4『pre-spawn → CANCELLED』口径注记」未落（现口径为：未进 IN_PROGRESS → CANCELLED，已进 → FAILED）。
- **O4** DISPATCHED 首轮放行窗口（spawn 在途毫秒级）`execution=null`——语义可接受，非缺陷（WorkerCard 显示「—（未在执行）」）。

## 状态落定

- 实测 `.stage` = `WORKING`；质量门「审查前状态」应为 `QUALITY_GATE`。按《07-state-machine》§状态规则（审查者审查前校验不一致则中止并提示调度者），**本报告未写 `.stage`**（技术结论 PASS 成立，不随状态跳变）。
- 处置（调度者两步）：① `stage_set(topic='atd-s2a-worker-loop', to='QUALITY_GATE', actor='调度者')` 补 r1 修复后的「重新递交」跳；② 再由 `stage_set(..., to='DONE', actor='审查者')` 落 DONE（先例：atd-s1-core-domain、opportunity-dispatch-reject 均由审查者从 QUALITY_GATE 落 DONE；如调度者按 §39「终检双 PASS 后 DONE」口径自行落定亦一致）。

## 结论

# PASS

状态：WORKING（未变更——见「状态落定」；审查前状态与任务书不符，已按规章中止状态写入并提示调度者）

一句话理由：r1 的 high 核心与 medium#2/#3 已实质闭合（终态不再误报执行中且自刷新循环根治、spawn 失败时序正确走 CANCELLED、blocks 反查方向与前端接线正确、文档回写与死配置接线均落实），Checker 独立复跑 fence 全绿（116/116 + 三包 tsc + web build + frozen install）；遗留 2 处 medium（BLOCKER/STORY 伪「执行中」残余、CANCELLED 终态与「可重新放行」承诺矛盾）与 3 处 low 不阻塞 —— 84/100 PASS。
