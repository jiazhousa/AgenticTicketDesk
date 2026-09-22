# 审查报告：atd-s2a-worker-loop（Story Spec，Revision 1）

- **审查类型**：Story 级 Spec 审查（S-S5 轻量档，按任务书扩展维度执行）
- **审查对象**：`~/project/AgenticTicketDesk/.specpipe/plans/atd-s2a-worker-loop/spec.md`
- **基准材料**：Epic `agentic-ticket-desk/epic-spec.md`（v4 已放行；§9 S2a 行范围来源 / §4.4 / §5 / §6 / §7）；S1 `atd-s1-core-domain/spec.md` 与 S1 实际代码（`apps/server/src/domain/status.ts`、`db/schema.ts`、`routes/tickets.ts`）；opencode 官方 CLI 与权限文档（外部核验，2026-09-22）
- **日期**：2026-09-22

## 总体评价

**不通过（REJECT）**。spec 主体结构质量较好：事件流映射带实测样本、完成报告文件化设计（进程结束后读文件 + zod 校验 + 重试兜底）可靠性论证成立、MUST 六条均有实现点、状态机扩展方向与 S1 白名单机制可无冲突衔接。但存在 2 项 high 与 5 项 medium：P1 状态机入边缺失（DISPATCHED→FAILED）且与 Epic §5 冲突，B2/B4 依赖该路径；P2 第三裁决「改派」机制未闭环且无验收（Epic S2a 验收⑤强制三路）。medium 覆盖绑定校验时序、MUST-2/6 验收缺口、多轮日志覆盖语义、目标仓配置缺项、回收语义自相矛盾。修订后重审。

## 维度结论

### 1. Epic 一致性
- 覆盖对齐：§2 与 Epic §9 S2a 行组件逐项对应（worker-core/Registry、worker-opencode task、worktree 管理、L2 基础、L3+BLOCKED(pending:l3)+BLOCKER）；「不做」边界（interactive、pending:agent、池、文件集校验、DREAM、多仓）与 Epic 里程碑裁剪一致；§6 MUST 表覆盖 MUST-1..6 全部六条。
- 偏差：P1（FAILED 入边与 Epic §5「仅两种入边」冲突）、P2（改派为 Epic 验收⑤强制项，未闭环）、P9（BLOCKED→CANCELLED 为 Epic §5 允许边，未纳入）、P10（Epic 行含「L1 留痕」，spec 无落点）、P8（计数笔误）。
- 可接受简化（记录备查）：S2a 的 L2 重试在 IN_PROGRESS 内原地重试、不落 pending:agent——与 Epic §4.2 完整 L2 语义有差异，但 Epic §5 已明示 pending:agent 随 S3；建议 spec 显式标注该差异留待 S3 收敛（非阻塞）。

### 2. 完备性
- B1-B8 覆盖主链与大部分异常（全链/建 worktree 失败/卡点双裁决/崩溃/超时/报告缺失重试/模板校验/回收），条目可测性整体良好。
- 验收缺口：改派路径无 B（P2）；MUST-2（权限注入生效）与 MUST-6（凭据校验）无 B（P4）。
- 状态机扩展边集不完整：缺 DISPATCHED→FAILED（P1）；缺 BLOCKED→CANCELLED（P9）。
- dispatch 输入未定义：目标仓来源 config（P6）；多轮执行日志语义（P5）。
- BLOCKER 生命周期闭环基本完整（自动创建→人在 UI 留言处置→三裁决→父单转移；「BLOCKED 恰对应一张未关 BLOCKER」不变式清晰），但改派机制与 §4 第 2 步冲突（P2）、worker 绑定校验时序矛盾（P3）。

### 3. 一致性内检
- 与 S1 状态机衔接：新边为增量扩展（IN_PROGRESS 出边由 ['DONE'] 扩为 ['DONE','BLOCKED','FAILED']，BLOCKED/FAILED 为新增状态），不与既有白名单冲突。注意：BLOCKED→DISPATCHED 会经过 S1 的 blockedBy 门（BLOCKER 未 DONE 时拒绝 DISPATCHED），须「先关 BLOCKER 再转移父单」，建议在 spec 明写时序（见 P2 建议）。
- 「继续=原 worktree 重新 spawn、prompt 追加 BLOCKER 处理结论」与 dispatch 流程兼容 ✓（跳过建 worktree）；改派恰缺同类定义（P2）。
- 报告 schema、事件流映射、profile 契约内部自洽（schema 字段 ↔ §4 第 6 步读取 ↔ commits 校验链闭合）；偏离点：commits「取并集」（P11）、失败判定优先级未声明（P12）、prompt 传递方式（P13）。
- 日志落盘命名与多轮执行不自洽（P5）；回收语义 §4 与 B8 自相矛盾（P7）。

### 4. 技术合理性（轻量）
- **报告文件化**：进程结束后读 `atd-report.json` + zod 校验 + 失败重试——不依赖 LLM 输出格式，可靠性论证成立，方案采纳 ✓。
- **worktree 置目标仓 `.atd-worktrees/`**：可行（审计直观、路径约束易表达、与 cwd 限定配合），但以目标仓 gitignore 为前提而 spec 仅「建议」——ATD 自身 .gitignore 未含该条目（已核实），dogfood（B1）即产生未跟踪噪声（P15）；外置路径可完全规避污染但损失审计直观性，当前取舍可接受、需补保护。
- **超时/重试参数位置**：`timeoutMin` 在 profile yaml（合理，可按 worker 差异化）；重试次数「1 次」无归位与可配性说明（P14）。
- **MUST-2 载体**：官方 opencode CLI 全局旗标仅 `--help/--version/--print-logs/--log-level/--pure`，**不存在 `--config` 旗标**；配置/权限注入通道为 `OPENCODE_CONFIG` / `OPENCODE_CONFIG_CONTENT` / `OPENCODE_PERMISSION` 环境变量；deny 语法为「工具键 × 对象模式规则」（如 `{"bash": {"git push *": "deny"}}`，last match wins）；默认 most-allow、`external_directory` 与 `doom_loop` 默认 ask、`.env` 读取默认 deny（修正建议见 P4）。
- 事件流映射有实测样本（§3.3）✓；`--format json` / `--dir` 与官方文档一致 ✓。

## 问题清单

**P1 — DISPATCHED→FAILED 入边缺失，且与 Epic §5 冲突（B2/B4 依赖）— 严重程度：high**
- 影响：§4 第 2 步定「worktree 创建失败 → FAILED」、B2 要求 FAILED，但 §3.5 新增边仅 5 条、无 DISPATCHED→FAILED；Epic §5 又明确 FAILED 入边仅来自 IN_PROGRESS（两种原因）与 BLOCKED 裁决终止。三处契约冲突，B2 无法按字面实现（工单停在 DISPATCHED 则全链挂起）；B4（临时 profile `exit 1`，无任何事件输出 → 未进入 IN_PROGRESS）同触此雷。
- 建议：二选一并同步文档——(a) 推荐：建 worktree 作为转移前置（transition 请求内先建，失败 422 且状态不变，更贴合 MUST-1「无 worktree 不派发」）；(b) 显式新增 DISPATCHED→FAILED 边，并在 Epic 侧留修订记录（下次 Epic 触碰同步）。同时明确 IN_PROGRESS 的入边触发（「首个事件流输出」对无输出的崩溃场景不可达）。

**P2 — 第三裁决「改派」未闭环：机制与 §4 第 2 步冲突 + 无验收 — 严重程度：high**
- 影响：§3.5「裁决=改派：换 worker profile 重新 dispatch」+ §3.6 三路裁决，但 §4 第 2 步把建 worktree 写死 `git worktree add <repo>/.atd-worktrees/t{id} -b atd/t{id}`；改派时该路径（BLOCKED 不触发回收）与分支均已存在，命令必失败 → 按 §4 又落 FAILED，改派路按书写方式不可能成功。B3 仅测「终止」「继续」，未覆盖改派，而 Epic §9 S2a 验收⑤明确三路恢复正确。
- 建议：明确定义改派机制（推荐：复用原 worktree，跳过建 worktree，仅换 profile、重建 prompt 并重新 spawn；worktree 缺失时才创建），或定义轮次命名 `atd/t{id}-r{n}` 与旧 worktree 处置；补 B 项（临时第二 profile → 关 BLOCKER 选改派 → 新 worker 执行 → DONE）。同时写明关单与转移时序：先关 BLOCKER（S1 blockedBy 门要求）再转移父单。

**P3 — worker 绑定校验时序矛盾（§4 第 1 步）— 严重程度：medium**
- 影响：「transition 成功后 → 解析 worker 绑定（无绑定 → 422）」若字面实现，422 返回时状态已转 DISPATCHED 且无 worker，工单挂起；与 Epic §5「DISPATCHED：已选定 worker 与 worktree」相悖。
- 建议：绑定校验定义为转移前置条件（transition 请求内校验 workerId 必填且在 Registry 中存在，失败 422 状态不变）；改派路径同走该校验。

**P4 — MUST-2 / MUST-6 验收缺口 + MUST-2 载体需修正 — 严重程度：medium**
- 影响：B1-B8 无一项验证「宿主侧权限注入真正生效」（MUST-2），也无「profile 含疑似凭据 → 注册拒绝」用例（MUST-6，§6 有校验规则但无 B）；两者均为 Epic S2a 验收②「MUST-1/2/5/6 生效」显式要求。且 §6 MUST-2 建议的命令模板追加 `--config permission.bash.deny=...` 与官方 CLI 不符（不存在 `--config` 旗标），按字面执行会报错。
- 建议：(a) 载体修正为环境变量注入（`OPENCODE_PERMISSION` 或 `OPENCODE_CONFIG_CONTENT` 内联 JSON）；deny 规则写成对象模式（`{"bash": {"git push *": "deny"}}`，last match wins）；(b) 补 B 项：worker 尝试 `git push` / 越界路径写 → 被拦截断言；profile yaml 含疑似 token → 注册拒绝；(c) 利用官方默认 `external_directory=ask`，显式配为 deny 作为 MUST-4 路径边界的第二道锁（无人值守下 ask 无法交互）。

**P5 — 多轮执行的日志落盘语义未定义（MUST-5）— 严重程度：medium**
- 影响：§3.2 固定命名 `data/logs/t{ticketId}.raw.jsonl` / `.events.jsonl`，而 L2 重试（§3.4）、裁决继续（§3.5）、改派均对同单多次 spawn；覆盖/追加未声明——覆盖即丢前轮输出，违背 MUST-5「全量落盘、关单前不可清理」。
- 建议：引入轮次维度（如 `data/logs/t{id}/run-{n}.raw.jsonl`，run 号写 transition/attempt 记录），或显式声明追加语义与分隔约定；并写明 data/logs 基准目录（S1 惯例 apps/server/data，已 gitignore）。

**P6 — 目标仓配置（config.yaml）未列交付物/未定义来源 — 严重程度：medium**
- 影响：§4 第 2 步顺带引用「config.yaml 单仓」为 `<repo>` 来源，但 §2 范围与 §7 验收均无该交付物；S1 未落地（已核实：server 代码无 config/worktree 痕迹、仓内无 config.yaml、pnpm-workspace.yaml 仅 `apps/*`）；Epic §7 将「仓注册（M1 单仓 config yaml 声明目标 git 仓路径）」列为 server 职责。dispatch 关键输入无契约来源，B1 前置缺失。
- 建议：列入范围并声明最小契约——位置、字段（repo 绝对路径，可选默认 worker/超时覆盖）、启动校验（路径存在且为 git 仓，失败启动报错）。

**P7 — 回收语义自相矛盾（§4 回收行 vs B8）— 严重程度：medium**
- 影响：§4 写「回收=删 worktree+删分支 atd/t{id}，DONE 默认不删分支」；B8 写「worktree 与分支删除」。默认语义直接冲突；且删分支使 commit 不可达（dangling），与「worktree 保留（审计）」及 S4「diff 抽取按 commit 关联」目标冲突（报告/关联表只存 sha，可达性靠分支/引用）。
- 建议：统一默认语义（推荐默认保留分支，仅显式 purge 时删；或回收时自动打 ref/tag 保可达），B8 相应改写。

**P8 — §2 第 8 条「Epic §6 五条」计数笔误 — 严重程度：low**
- 影响：§6 表实为六条（MUST-1..6），口径不一致。
- 建议：改为「六条」。

**P9 — BLOCKED→CANCELLED 边缺失（Epic §5 明示允许）— 严重程度：low**
- 影响：Epic §5 写「BLOCKED → CANCELLED（人为取消，允许）」，§3.5 新增边集未含——等待人的卡死工单少一条人工取消出口。
- 建议：补边并在 B3 或备注中体现。

**P10 — L1 留痕与 worker-core 生命周期接口无落点 — 严重程度：low**
- 影响：Epic §9 S2a 行含「L1 留痕」，§4.4 定义 WorkerRuntime 生命周期接口（doPromptTurn/doStop/doDestroy/doDetach）；spec §2 未提 L1，worker-core 交付物（事件流类型+profile schema+Registry）未含生命周期接口（S2a 至少需要 doStop=超时杀进程）。
- 建议：明确 task 模式 L1 落点（如 worker 自决 → 事件流+报告+转移备注即留痕），worker-core 声明 doPromptTurn/doStop 最小接口。

**P11 — commits「取并集」可能保留伪造 sha（§3.4）— 严重程度：low**
- 影响：报告 commits 与 git 实测取并集，会把不存在于 git 的 sha 写入 ticket_commits，污染审计链。
- 建议：以 git 实测为准（交集语义），未知 sha 记 warn 并剔除。

**P12 — 失败判定细则未定义 — 严重程度：low**
- 影响：`tool_use` 仅映射 `state=completed`，error 态无映射；「退出码非 0」与「存在合法 blocked 报告」并存时优先级未声明（§3.2 与 §4 第 6 步冲突面）；status=done 但零 commit 是否合法未声明。
- 建议：补一条判定优先级（建议：退出码非 0 或 finish 语义缺失 → FAILED 优先，报告仅在正常退出时消费）。

**P13 — prompt 传递方式 `$(cat {{promptFile}})` 的 shell 解释风险（§3.1）— 严重程度：low**
- 影响：prompt 含 spec 快照任意文本（引号/反引号/`$` 会被 shell 解释，换行折叠为空格），且未声明 spawn 是否经 shell。
- 建议：定义安全传递方式（stdin 或 `--file` 附件，或明确引号转义与 shell 策略），并把该约定写入 profile schema 模板变量语义。

**P14 — 运行期细则未归位 — 严重程度：low**
- 影响：重试次数「1 次」未说明可配性与位置（timeoutMin 在 profile，重试无归位）；离开 BLOCKED 时 pendingLabel('l3') 清理未声明（残留风险）；dispatch 编排在 server 进程内，重启/崩溃后 IN_PROGRESS 残留单与孤儿 worker 进程的最小策略未声明。
- 建议：补声明（重试次数位置；转移实现内保证清理；重启策略可先声明为「标记待人工核查」，M1 本地单用户可接受）。

**P15 — worktree 置目标仓 `.atd-worktrees/` 缺保护 — 严重程度：low**
- 影响：spec 仅「建议目标仓 gitignore」；ATD 自身 .gitignore 未含该条目（已核实），dogfood（B1 以 ATD 为目标仓）即现未跟踪噪声，worker 在仓根 commit 有误纳风险。
- 建议：编排层创建前校验/提示补齐（或自动写入自包含 `.gitignore`），并在 spec 记录「仓内 vs 仓外」取舍结论。

## 评分

**35 / 100**（high×2 = -24；medium×5 = -25；low×8 = -16；合计扣分 65，max(0, 100-65) = 35）

## 结论

# REJECT

- 阻断项：P1（DISPATCHED→FAILED 入边缺失/Epic §5 冲突）、P2（改派闭环缺失）；P3-P7 medium 建议一并修订。
- 状态：SPEC_REVIEWING → SPEC_DRAFT
