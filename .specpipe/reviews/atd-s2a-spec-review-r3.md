# 审查报告：atd-s2a-worker-loop（Story Spec，Revision 3）

- **审查类型**：Story 级 Spec 审查 r3（S-S5 轻量档按任务书扩展：r2 问题闭合核对 + 终检）
- **审查对象**：`~/project/AgenticTicketDesk/.specpipe/plans/atd-s2a-worker-loop/spec.md`（v3）
- **基准材料**：Epic `agentic-ticket-desk/epic-spec.md`（v4 已放行；§5 状态机与 FAILED 两入边口径 / §9 S2a 行验收 / §4.4 WorkerRuntime / §6 MUST 六条）；r1 审查报告（35/100）、r2 审查报告（73/100）；S1 实际代码核查（`apps/server/src/domain/status.ts` 的 TRANSITIONS、`apps/server/src/domain/ticket-service.ts` 的 transition/blockedBy 放行门、`apps/server/src/db/schema.ts` 的 worker_id 占位列）
- **日期**：2026-09-22

## 总体评价

**通过（PASS）**。r2 的两项核心矛盾均已实质消除：**H1**——IN_PROGRESS 进入点前移至「spawn 发起成功（进程存在）」后，崩溃与超时（B4/B5）及全部 post-spawn 终局均落在 IN_PROGRESS 态，`IN_PROGRESS→FAILED` 单边成立、FAILED 入边零新增，B4/B5 可按字面实现；**M1**——审计载体落定（raw 首行执行元数据）+ B9 验收落地。L 层 5 项中 L2/L4 完全闭合，L1/L3/L5 基本闭合。

残余问题 6 项：2 medium（H1 的 pre-spawn 失败分支声明仍未闭合；MUST-2「权限注入生效」行为断言仍缺）+ 4 low（Epic §5 注记未附注、§3.5 步引用笔误、L3/L5 少量细则），均可小改闭合，不阻塞进入用户审计与 impl 起草。

## r2 问题闭合核对（H1 / M1 / L1-L5）

| # | r2 问题（级别） | v3 处置（位置） | 判定 |
|---|---|---|---|
| H1 | 零输出崩溃/超时与「运行期失败」的 FAILED 路径不可达（high） | §4 步 4 重写：spawn 发起成功（进程存在）即 IN_PROGRESS（round+1），「首个事件」降为观测信号；§3.5 边集不变 | ⚠️ **基本闭合**：B4/B5 与 post-spawn 全部终局已可达（主阻断消除）；**pre-spawn 失败分支仍不可达**（§4 步 1 / 重启恢复 DISPATCHED 行 / §2 第 4 项时序）→ N1（伴随 N3） |
| M1 | MUST-2 权限注入「生效」无验收 + 审计载体未定义（medium） | §3.2「raw 首行为执行元数据（命令/env 注入摘要/基线 HEAD/轮次/timeoutMin）」+ B9 验收 | ⚠️ **部分闭合**：审计载体闭合；「生效」行为断言仍缺（B9 仅证注入存在，不证拦截发生）→ N2 |
| L1 | 改派引用「§4 步 3-6」不存在 + 多轮基线/commit 归集未明 + §3.8 基线两口径（low） | §4 补「多轮基线与归集」段（每轮基线=worktree 当前 HEAD、按轮并集、ticket_commits 含轮次列）；§4 尾注「走步 2-5」 | ⚠️ **部分闭合**：归集口径闭合；§3.5 改派行仍引「步 3-6」（与「步 2-5」及实际 1-5 步均不一致）→ N4；§3.8 两段式表述可顺手收敛 |
| L2 | 复用 worktree 陈旧报告未清理（low） | §4 步 2「清理 worktree 内陈旧 atd-report.json（防复用场景误读旧报告）」 | ✅ **完全闭合** |
| L3 | 运行期/配置归位残余 ①-⑤（low） | ①「转出 BLOCKED 时 pendingLabel 置 NULL」✓；② 重启恢复策略已声明（扫描 DISPATCHED/IN_PROGRESS → FAILED + 留言）△；③④⑤ 未见补充 | ⚠️ **部分闭合** → N5 |
| L4 | worker-core 生命周期接口无落点（low） | §2 第 1 项：doPromptTurn/doStop/doDestroy 保留声明，S2a task 模式仅实现 spawn+wait+kill | ✅ **闭合**（备注：Epic §4.4 的 doDetach 未列，属 interactive/S2b 生命周期，非阻塞） |
| L5 | 判定表细化四点（low） | 表头「自上而下首个命中」；§3.2 已定义 finish 由 code=0 合成 → 重叠命中序自洽（实际等价「退出码非 0 优先 FAILED」，与 r2 建议效果一致）；另三点未声明 | ⚠️ **部分闭合** → N6 |

## 终检专项

### 1. 验收可实现性（B1-B9）
- **B4/B5（r2 阻断场景）**：新进入点下链路可达——进程存在即 IN_PROGRESS，零输出退出 / 超时杀进程后走 IN_PROGRESS→FAILED。实现提示：`process.exit(1)` 极速退出需将「spawn 返回后置 IN_PROGRESS」安排在退出事件处理之前（同步落库即可，无真实竞态），不构成 blocker。
- **B1/B2/B3a-c/B6-B9**：对照 §3.4/§3.7/§4 逐项可达。B2 走前置三件套 422（不触状态机）；B3x 三裁决与边/UI 一一对应，且「先关 BLOCKER 再转移父单」与 S1 blockedBy 放行门兼容（`ticket-service.ts` 已核实）；B6 的 round=2 由 round 字段承载；B7/B9 为 Registry 与日志断言。
- 结论：**9 项验收全部可按字面实现** ✅。

### 2. Epic §5 口径一致性
- 边集：FAILED 两入边保持（IN_PROGRESS→FAILED、BLOCKED→FAILED），BLOCKED 三条出边与 CANCELLED 边逐条对应，未新增边 ✅。
- 偏差：IN_PROGRESS 语义注记（Epic「worker 已产出首个事件」vs v3「进程存在」）未附注，且 §3.5 标题/§4 步 4 尾句「保持/与 Epic §5 口径一致」仅对边集成立 → N3。
- 非阻塞记录：S2a 的 L2 原地重试与 Epic §4.2 pending:agent 的语义差异仍仅由 §8 间接表达（r2 已注明非阻塞，维持不扣分）。

### 3. 内部自洽（含 S1 事实核对）
- S1 事实：`TRANSITIONS` 现网 DISPATCHED=['IN_PROGRESS','CANCELLED']、IN_PROGRESS=['DONE']（与 spec 增量扩展面一致，无既有边冲突）；`worker_id` 已建（schema 注释「S1 空占位，S2a 消费」）、pendingLabel/round 为 S2a 新增（与「tickets 加」表述相符）；放行 blockedBy 门存在。
- 主链自洽：§3.5/§3.7/§4 的 L3 升级、重试、三裁决、回收、日志轮次内部一致 ✅。
- 残留不自洽点：§4 步 1 与步 4（N1）；§3.5 改派行 vs §4 尾注（N4）；§2 第 4 项时序行未与步 4 同步（N1）。

## 发现的问题（残余与新问题）

**N1 — pre-spawn 运行期失败的 FAILED 路径仍不可达（H1 残余）— 严重程度：medium**
- 事实链：
  1. §4 步 4 新规则：IN_PROGRESS 进入点=spawn 发起成功（进程存在）；
  2. §4 步 1（建/复用 worktree）、步 3 的 spawn 发起本身（如 profile command 所指可执行文件不存在 → exec 失败）均发生在该进入点**之前**，彼时工单处于 DISPATCHED；
  3. §4 步 1 与 §6-MUST1 行要求这些失败落 FAILED；但 §3.5 的 FAILED 入边仅 IN_PROGRESS→FAILED / BLOCKED→FAILED（声明不新增），S1 现网 `TRANSITIONS.DISPATCHED` 亦无 FAILED（已核实）→ 声明的路径不可达；
  4. §4 重启恢复「DISPATCHED 停留单同法（IN_PROGRESS→FAILED + 留言）」同样要求 DISPATCHED 态执行 IN_PROGRESS→FAILED 的未声明两步路；
  5. §2 第 4 项时序行仍为「…→ spawn → 事件流落盘 → IN_PROGRESS → 进程结束…」，与步 4 未同步。
- 影响：Builder 在 pre-spawn 失败分支需自行发明路径（挂死 DISPATCHED 或私加未声明两步转移）；配置错误 profile（命令不存在）属现实场景；无 B 项覆盖（B2 只测前置校验），不会当场红但契约不闭合。
- 建议（二选一，并同步 §2/§3.5/§4/§6-MUST1）：
  - (a) 进入点再前移半步至「异步执行块起点」（r2 原推荐）：转移成功后异步块启即 IN_PROGRESS（round+1），一次覆盖全部运行期失败分支；
  - (b) 保留现进入点，显式声明 pre-spawn 失败处置：「DISPATCHED →（标记）IN_PROGRESS → FAILED」两步路径 + 补 B 项（如临时 profile 指向不存在命令 → FAILED）。

**N2 — MUST-2「权限注入生效」仍无断言（M1 残余）— 严重程度：medium**
- 事实：B9 断言的是 raw 首行包含注入摘要（编排层自记），可证「注入了什么」，不可证「拦截是否发生」；§9 开放点「MUST-2 环境注入具体键名以实测为准」意味着键名选择错误时权限可静默失效，而现有验收全绿。
- 影响：Epic §9 S2a 验收②「MUST-1/2/5/6 生效」中 MUST-2 的可验证性不足；宿主侧强制收口（安全底线）缺端到端证据。
- 建议：补确定性断言——渲染出的 env / 临时配置内容包含正确 deny 对象规则（键名按实测固化后写入用例）；可选：狗粮（B1）中人工构造一次「worker 尝试 git push → 被拒」观察记录。注意：以临时 profile 直接跑 shell 命令**不经过** opencode 权限层，不能作为等价验证——须经 opencode 工具链构造。

**N3 — Epic §5 IN_PROGRESS 注记偏差未附注，spec 自称「口径一致」不准确 — 严重程度：low**
- 事实：Epic v4 §5 注记「IN_PROGRESS：worker 已产出首个事件」；v3 进入点=进程存在。r2 H1 采纳 (a) 时已明示「§5 注记需附注，留 Epic 修订记录」；v3 §3.5 标题/§4 步 4 尾句仍书「保持 Epic §5 口径」「与 Epic §5 口径一致」。
- 影响：用户按 Epic v4 理解状态语义会与实现偏差；Epic 修订记录缺位。
- 建议：补一句差异附注（「IN_PROGRESS 进入点由『已产出首个事件』前移至『进程存在』，Epic §5 注记待修订」），供用户审计时判断。

**N4 — §3.5 改派行仍引「§4 步 3-6」（不存在；与「步 2-5」不一致）— 严重程度：low**
- 位置：§3.5 第 4 行 vs §4 尾注；§4 实际仅 1-5 步。
- 影响：按「3-6」实现会跳过步 2（陈旧报告清理 + 本轮基线重录）——正是 L2 修复点与多轮归集的前提。
- 建议：统一为「步 2-5（worktree 复用、跳过创建）」；§3.8 基线行两段式表述顺手收敛为 S2a 单一简化口径。

**N5 — L3 残余：③④⑤ 未补声明（+ 孤儿进程假设）— 严重程度：low**
- ③ config「重试次数」（§2 第 8 项）与 §3.7 硬编码「1 次」的默认值/可覆盖关系未写；「默认超时」与 profile `timeoutMin` 的关系亦未写（一句话可闭合）；
- ④ `data/logs`、`data/prompts`（§3.2/§4）与 `{dataDir}/worktrees`（§3.8）记法不统一，基准目录未明；
- ⑤ config.yaml 位置与启动校验（文件存在 / repoPath 为 git 仓，否则启动报错）未写；
- 附：重启恢复假设「（进程已随重启消亡）」不必然成立（server 崩溃时子进程可存活为孤儿）；S2a 可接受，建议写明假设边界或最小兜底一句（如重启时尝试清理残留进程组）。

**N6 — L5 残余三点未声明 — 严重程度：low**
- ① done 报告零 commit 的合法性未声明（建议：合法但留痕，或定义为 DONE 前置校验）；
- ② `tool_use` 非 completed（error 态）的事件映射未写（§3.2 仅 completed；raw 全量落盘可兜底，建议补一句映射或显式声明忽略）；
- ③ 重试耗尽型 L3 升级（无 blocked 报告）的 BLOCKER 首条留言来源未定义（§3.6 仅「blockReason 全文」；建议补「连续 N 轮未产出有效报告（轮次/退出码摘要）」类系统生成说明）。

## 评分

**82 / 100**（medium×2 = -10；low×4 = -8；合计扣分 18，max(0, 100-18) = 82）

## 结论

# PASS

- 阻断项：无。r2 的 H1/M1 主矛盾均已实质消除（B4/B5 可实现、审计载体落地）；残余为 2 项 medium（pre-spawn 失败路径声明、MUST-2 生效断言）与 4 项 low（文档一致性与细则声明），均可小改闭合，不阻塞进入用户审计。
- 建议修复顺序（小改，可在用户审计反馈或 impl 起草前一并处理）：N1 → N2 → N3/N4 → N5/N6。
- 状态：SPEC_REVIEWING → SPEC_USER_AUDIT

---

**判定：PASS** — H1/M1 主阻断消除、B1-B9 全部可按字面实现；残余 2 medium + 4 low 属边缘分支声明与验收深度问题，未达再驳回门槛。
