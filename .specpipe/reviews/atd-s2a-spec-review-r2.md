# 审查报告：atd-s2a-worker-loop（Story Spec，Revision 2）

- **审查类型**：Story 级 Spec 审查（S-S5 轻量档，按任务书扩展维度执行；含 r1 15 项闭合核对）
- **审查对象**：`~/project/AgenticTicketDesk/.specpipe/plans/atd-s2a-worker-loop/spec.md`（v2）
- **基准材料**：Epic `agentic-ticket-desk/epic-spec.md`（v4 已放行；§9 S2a 行 / §4.2 / §4.4 / §5 / §6）；r1 报告 `reviews/atd-s2a-spec-review-r1.md`；S1 实际代码核查（`apps/server/src/domain/status.ts` 的 `TRANSITIONS`、`ticket-service.ts` 的 transition 白名单与 blockedBy 门）
- **日期**：2026-09-22

## 总体评价

**不通过（REJECT）**。修订质量整体高：r1 两项 high 中「改派闭环」已实质闭合（原 worktree 复用 + B3c 验收），medium 层（多轮日志/回收语义/config 交付物/绑定时序）与 low 层多项完全闭合——15 项中 **10 项完全闭合、5 项部分闭合**。但残留 **1 项 high**：r1 P1 的第二半（IN_PROGRESS 入边触发明确化）未落实——**零输出崩溃/超时（B4/B5）与「运行期失败」场景下工单尚未进入 IN_PROGRESS，却要求落 FAILED，而 FAILED 仅两条入边（IN_PROGRESS→FAILED、BLOCKED→FAILED）**；§4 第 1 步仍写「若运行期仍失败 → IN_PROGRESS→FAILED 走崩溃路径」，而建 worktree 发生在入 IN_PROGRESS 之前，与 §3.5「FAILED 入边不新增、保持 Epic §5 口径」自相矛盾。另 1 项 medium（MUST-2 生效无验收）与 5 项 low。修订后重审。

## r1 15 项闭合核对表

| # | r1 问题（级别） | v2 处置（位置） | 判定 |
|---|---|---|---|
| P1 | DISPATCHED→FAILED 入边缺失/Epic 冲突（high） | 选项 (a) 采纳：放行前置三件套校验（§4），worktree 失败 422 且状态留 SPEC_READY；B2 改写（§7） | ⚠️ **部分闭合**：主场景（建 worktree 失败）已消除；零输出崩溃/超时的 IN_PROGRESS 入边触发仍未明确（→ H1） |
| P2 | 改派未闭环 + 无验收（high） | §3.5 增 BLOCKED→DISPATCHED（原 worktree 复用）；§3.8「已存在同名单则复用」；B3c 验收 | ✅ 闭合（残余：§3.5「§4 步 3-6」引用错误 → L1） |
| P3 | worker 绑定校验时序（medium） | §4 ① worker_id 非空（放行时必选，失败 422 不转移）+ §5 放行弹层 | ✅ 闭合 |
| P4 | MUST-2/6 验收缺口 + MUST-2 载体错误（medium） | §6-MUST2 改环境变量注入（声明 opencode CLI 无 `--config` 旗标）；B7 补注册防护（git push / 疑似 token） | ⚠️ 部分闭合：载体已修正、MUST-3/6 验收补齐；**MUST-2「权限注入生效」仍无断言**（→ M1） |
| P5 | 多轮日志覆盖（medium） | §3.2 t{id}.r{n} 双 JSONL + append 不覆盖；§3.5 round 字段；B6 round=2 断言 | ✅ 闭合（残余：日志基准目录未明 → L3） |
| P6 | config.yaml 未列交付物（medium） | §2 第 8 项 + 字段清单（repoPath / dataDir / 默认超时 / 重试次数） | ✅ 闭合（位置与启动校验可再明确，非阻塞 → L3④⑤） |
| P7 | 回收语义矛盾（medium） | §3.8 keepBranch 默认 true（留分支）；B8 改写为一致口径 | ✅ 闭合 |
| P8 | 「五条」计数笔误（low） | §2 第 9 项改「MUST 六条实现点」 | ✅ 闭合 |
| P9 | BLOCKED→CANCELLED 缺边（low） | §3.5 补「BLOCKED → CANCELLED（人为取消）」 | ✅ 闭合 |
| P10 | L1 留痕/生命周期接口无落点（low） | §2 第 6 项明确 L1 留痕=事件流与报告本身 | ⚠️ 部分闭合：L1 落点已写；worker-core 生命周期接口（doPromptTurn/doStop）仍无（→ L4） |
| P11 | commits 并集可留伪造 sha（low） | §3.4 以 git 实测为准（对比 spawn 前基线），报告仅交叉校验、多余项留痕不采信 | ✅ 闭合 |
| P12 | 失败判定细则未定义（low） | §3.7 新增判定表（含超时/崩溃/报告缺失分流） | ⚠️ 部分闭合：重叠情形优先级、done 零 commit、tool_use error 态映射仍缺（→ L5） |
| P13 | prompt shell 注入风险（low） | §3.1 spawn 参数数组不经 shell，{{prompt}} 单参数替换 | ✅ 闭合 |
| P14 | 运行期细则未归位（low） | §2 第 8 项 config 含重试次数 | ⚠️ 部分闭合：pendingLabel 清理、重启/孤儿进程策略未声明（→ L3） |
| P15 | worktree 置目标仓内缺保护（low） | §3.8 移至 {dataDir}/worktrees/（ATD 管理目录，不动目标仓文件） | ✅ 闭合 |

## 维度复审

### 1. Epic 一致性
- §2/§3.5/§6 与 Epic §9 S2a 行、§4.4、§5、§6 逐项对应良好；「不做」边界与里程碑裁剪一致（pending:agent 归 S3、interactive 归 S2b）。
- **三裁决与状态机边一一对应 ✓**：继续↔BLOCKED→IN_PROGRESS、终止↔BLOCKED→FAILED、改派↔BLOCKED→DISPATCHED，与 Epic §4.2 裁决映射逐字一致；关单时序（先关 BLOCKER 再转移父单）由 §3.6「关单时选裁决 → 按上表转移父单」隐含，且与 S1 blockedBy 门（`transition()` 对 to=DISPATCHED 校验依赖全 DONE，已核实代码）兼容。
- **FAILED 两入边口径**：形式上守住（未新增边），但边界不自洽（H1）——Epic §5「仅两种入边」的成立以「崩溃发生在 IN_PROGRESS」为前提，v2 的零输出场景破坏该前提。
- 非阻塞记录（r1 遗留建议）：S2a 的 L2 重试为 IN_PROGRESS 内原地重试（不落 pending:agent），与 Epic §4.2 完整 L2 语义的差异仅由 §8「无 pending:agent」间接表达；建议 §3.7 补一句「该差异随 S3 重试引擎收敛」（非阻塞，不扣分）。

### 2. 完备性
- B1-B8（含 B3a/b/c 三拆分）覆盖主链与异常；三裁决均有验收 ✓。
- 剩余缺口：M1（MUST-2 生效无 B）；H1（B4/B5 状态路径不可达）。
- 交付物与范围对齐：config.yaml / 回收参数 / round 字段 / 日志轮次均已入册。

### 3. 一致性内检（三裁决与边、§3.7 与 §3.5/§3.6 核对）
- §3.7 判定表与 §3.5 边集：报告 blocked↔IN_PROGRESS→BLOCKED(pending:l3) ✓；重试耗尽↔同一 L3 边 ✓；崩溃/超时↔IN_PROGRESS→FAILED（**状态前提问题见 H1**）；裁决终止↔BLOCKED→FAILED ✓。
- §3.7 与 §3.6 无直接矛盾；边界缺口：重试耗尽型 L3 升级无 blockReason 来源，而 §3.6 只定义「首条留言=blockReason 全文」（→ L5）。
- 其它不一致：§3.5 改派「§4 步 3-6」引用不存在（§4 仅 1-5 步，→ L1）；复用 worktree 的陈旧报告误读风险（→ L2）；data/logs、data/prompts 与 {dataDir} 记法不统一（→ L3④）。

### 4. 技术合理性（轻量）
- worktree 前置化 + 复用（分支延续）方案合理；移出目标仓彻底消除污染与 gitignore 依赖 ✓（优于 r1 原方案）。
- MUST-2 环境变量注入修正与 opencode 实测一致（无 `--config` 旗标）✓；参数数组 spawn 消除 shell 注入面 ✓；文件化报告 + zod 校验 + 重试兜底可靠性论证保持 ✓。
- 遗留技术疑问：H1（状态路径）；M1（审计载体：env 注入内容如何进入可审计记录未定义——环境变量不进入 worker stdout）。

## 问题清单（含 r1 残余）

**H1 — 零输出崩溃/超时与「运行期失败」的 FAILED 路径不可达，与「FAILED 入边不新增」自相矛盾 — 严重程度：high**
- 事实链：
  1. §4 规定「首个事件流输出 → IN_PROGRESS（round+1）」（§2 第 4 项同序）；
  2. B4（`node -e "process.exit(1)"`）与 B5（超时前无输出的 sleep 任务）均产生零事件，工单始终停在 DISPATCHED；
  3. §3.7 判定表要求上述情形落 FAILED，而 §3.5 的 FAILED 入边仅 IN_PROGRESS→FAILED 与 BLOCKED→FAILED（声明「不新增、保持 Epic §5 口径」）；
  4. S1 现网白名单 `TRANSITIONS.DISPATCHED = ['IN_PROGRESS','CANCELLED']`（`apps/server/src/domain/status.ts` 已核实），无 DISPATCHED→FAILED；
  5. §4 第 1 步仍写「若运行期仍失败 → IN_PROGRESS→FAILED 走崩溃路径」，而建 worktree 先于 spawn、更先于首个事件——彼时工单并非 IN_PROGRESS。
- 影响：B4/B5 无法按字面实现（Builder 必须私自补一条未声明的状态路径或改变 IN_PROGRESS 进入点），状态机契约与验收互斥；r1 P1 明确要求「同时明确 IN_PROGRESS 的入边触发」，v2 未落实。
- 建议（二选一，并在 §3.5/§3.7/§4 与 B4/B5 同步）：
  - (a) **统一 IN_PROGRESS 进入点为「执行阶段启动」（推荐）**：转移成功后异步执行块起点即 IN_PROGRESS（round+1，「首个事件输出」降为观测/UI 信号），使崩溃/超时/运行期失败全部落 IN_PROGRESS→FAILED；对 Epic 影响最小（边集不变，仅 §5 注记「IN_PROGRESS：worker 已产出首个事件」需附注，留 Epic 修订记录）。
  - (b) 显式新增 DISPATCHED→FAILED 边（限「spawn 后、首个事件前的不可恢复失败」），并在 Epic 侧留修订记录（§5「仅两种入边」措辞同步）。
  - 附带：补报告消费优先级——报告仅在正常退出（code=0 且 finish）时消费；退出码非 0 / finish 缺失优先 FAILED（r1 P12 建议原文）。

**M1 — MUST-2「权限注入生效」仍无验收项（P4 残余）+ 审计载体未定义 — 严重程度：medium**
- 影响：Epic §9 S2a 验收②显式要求「权限注入」生效；B2 覆盖 MUST-1、B7 覆盖 MUST-3/6，唯 MUST-2 无断言（worker 尝试 `git push` / 写 worktree 外路径 → 被拦截）。§6-MUST2「注入内容出现在 raw 日志可审计」无载体定义（环境变量不进入 worker stdout，需编排层另行落盘）。
- 建议：补 B 项（临时 profile 执行 push / 越界写 → 断言被拒）；§6 写明注入内容的审计落点（编排日志 / round 日志头）。

**L1 — 改派步骤引用「§4 步 3-6」不存在 + 多轮基线/commit 归集口径未明 — 严重程度：low**
- §3.5 改派行引用「§4 步 3-6」，而 §4 流程仅 1-5 步；多轮（L2 重试/继续/改派）下 §3.4「对比 spawn 前基线 HEAD」是否每轮重录、commit 落库是逐轮并集还是仅末轮，未定义（影响 B3b/B3c 的 commit 审计完整性）；§3.8 基线行「父单最近 commit 所在分支 HEAD（S2a 简化：一律 repo 默认分支 HEAD）」两口径并列悬空。
- 建议：改为「重新走 §4 第 1-5 步（建 worktree 跳过/复用）」；写明每轮 spawn 前重录基线、commit 按轮并集归集；§3.8 删除简化前的悬空口径。

**L2 — 复用 worktree 的陈旧 `atd-report.json` 未声明清理 — 严重程度：low**
- 继续/改派复用原 worktree，上一轮报告文件仍在；若新一轮正常退出但未写报告，§3.7「报告缺失」判定会读到旧报告，导致误分流（B6 语义在复用场景失真）。
- 建议：每轮 spawn 前删除/重命名 worktree 根报告文件，写入 §4 步骤。

**L3 — 运行期/配置归位残余（P14+小项） — 严重程度：low**
- ① 离开 BLOCKED 时 pendingLabel 的清理未声明；② server 重启/崩溃后 IN_PROGRESS 残留单与孤儿 worker 进程的最小策略未声明；③ config 的「重试次数」与 §3.7 硬编码「1 次」的默认值关系未写；④ data/logs、data/prompts 相对 dataDir 的基准目录未明（§3.2/§4 与 §3.8 记法不统一）；⑤ config.yaml 位置与启动校验（路径存在且为 git 仓）可补。
- 建议：逐条补一句。

**L4 — worker-core 生命周期接口仍无落点（P10 残余） — 严重程度：low**
- Epic §4.4 的 WorkerRuntime 含 doPromptTurn/doStop/doDestroy/doDetach；S2a 至少需要 doStop（超时杀进程）。§2 第 1 项交付物未列。
- 建议：声明最小接口（doPromptTurn/doStop），或显式说明 S2a 由编排层直控进程、WorkerRuntime 接口随 S2b 引入。

**L5 — 失败判定表残留细化项（P12 残余） — 严重程度：low**
- 「退出码 0 + 无 finish + 报告 blocked」重叠情形的优先级未写；done 报告零 commit 是否合法未声明；tool_use 非 completed（error）态无映射；重试耗尽型 L3 升级的 BLOCKER 内容无来源（§3.6 仅定义 blockReason 全文）。
- 建议：逐条补一句判定/兜底约定。

## 评分

**73 / 100**（high×1 = -12；medium×1 = -5；low×5 = -10；合计扣分 27，max(0, 100-27) = 73）

## 结论

# REJECT

- 阻断项：H1（零输出崩溃/超时与运行期失败的 FAILED 状态路径不可达；B4/B5 无法按字面实现，且与 §3.5「FAILED 入边不新增」自相矛盾）。
- 建议修订顺序：H1 → M1 → L1/L2（契约细化）→ L3/L4/L5（补声明）。
- 状态：SPEC_REVIEWING → SPEC_DRAFT

---

**判定：REJECT** — 改派闭环等 10 项已实质修复，但「零输出崩溃/超时 → FAILED」的状态路径与「FAILED 入边不新增」声明仍互斥（B4/B5 不可实现），须先闭合该状态机契约缺口。
