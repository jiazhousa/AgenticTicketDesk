# 质量门审查报告: atd-s2a-worker-loop (Revision 1)

> **落盘说明**：仓内路径 `/home/starlex/project/AgenticTicketDesk/.specpipe/reviews/` 写入被权限白名单拒绝（session 外路径，与 S2a 三轮 impl 审查报告同因），本报告落 `~/doc/.specpipe/reviews/atd-s2a-quality-gate-r1.md`，由 Oracle 复制（归位）至 `/home/starlex/project/AgenticTicketDesk/.specpipe/reviews/atd-s2a-quality-gate-r1.md`。

- 类型：Story 质量门全面审查（S-S10 终检）
- 对象：worktree `/home/starlex/project/AgenticTicketDesk-s2a`，分支 `dev/feat/atd-s2a-worker-loop` @ `f513aee`（已推远端）
- commit 链：`f513aee`（Oracle 收尾修复 5 文件）← `48c798d`（revert 探针）← `99af591`（worker 误提主仓探针）← `893e053`（merge 块B）← `d174784`（块A 55 文件）← `42f5f7f`（块B web 11 文件）
- 基准：`.specpipe/plans/atd-s2a-worker-loop/spec.md` v4（B1-B9 唯一验收来源）+ `impl.md` v3（含 M1 补丁并入）
- 状态校验：工作流根 `.stage` = `QUALITY_GATE`（与任务书一致）；`.stage-history` 第 16-17 条 = 调度者 09-23 15:41 两次转移（IMPL_APPROVED→WORKING→QUALITY_GATE）；`git status` 干净
- 日期：2026-09-23

## 总体评价

**不通过**。编译/测试面无可指摘（Checker 独立复跑三包 114 用例全绿 + 三包 tsc + web 构建 + frozen-lockfile 校验 + B1/B9 磁盘实证逐条核验），但代码面存在 **1 处 high 跨块契约背离**：详情接口的 `execution` 语义（服务端「最近一次进入 IN_PROGRESS 的时间戳，永不置 null」）与前端消费口径（「进程结束置 null」= running 判据）不一致，直接后果是**任何已执行工单（含 DONE）的详情页会误显「执行中」标签并进入 5s 轮询 + 每轮触发详情重载的自刷新循环**——恰好落在用户验收要点的路径上（交付说明要求用户点开 DONE 工单看事件流/报告卡）。另有 2 处 medium（spawn 发起失败的终态与 spec §4 不符；spec/impl 未回写 B1 实证修订）。

## 质量评分

**70 / 100**（critical 0 / high ×1 = -12 / medium ×2 = -10 / low ×4 = -8）

| 严重度 | 条数 | 扣分 | 小计 |
|---|---|---|---|
| critical | 0 | -25 | 0 |
| high | 1 | -12 | -12 |
| medium | 2 | -5 | -10 |
| low | 4 | -2 | -8 |

## fence 结果

- 说明：项目 `{wf}/fence.sh`（`/home/starlex/project/AgenticTicketDesk-s2a/.specpipe/fence.sh`）为四包实脚本（install + 三包 tsc + 三包 test + web build），Checker 按其四包清单**逐条独立复跑**（同一 worktree、未改任何文件）：
- 单元测试：`@atd/worker-core` 7 用例，7 通过，0 失败，0 跳过（~0.4s）
- 单元测试：`@atd/worker-opencode` 9 用例，9 通过，0 失败，0 跳过（~0.4s）
- 单元测试：`@atd/server` 98 用例，98 通过，0 失败，0 跳过（8 文件，3.4s；含 S1 基线 46）
- E2E 测试：无（本项目无 E2E 基建，S2a 范围内合理；真实链路以 B1 真跑 + 临时 git 仓 spawn 用例覆盖）
- 合计：**114 用例，114 通过，0 失败，0 跳过**
- 类型检查：`@atd/worker-core` / `@atd/worker-opencode` / `@atd/server` 三包 `tsc --noEmit` 零错误；`@atd/web` build 脚本本身含 `tsc --noEmit` → web 类型检查 + vite 构建通过（3049 模块，仅 antd 单包 >500kB 常规体积提示，S1 同款非错误）
- 依赖一致性：`pnpm install --frozen-lockfile` → `Lockfile is up to date`（5 workspace 项目，块 A 生成的 lockfile 可复现安装）
- B1/B9 实证独立核验（未重跑真机 opencode，改用 Oracle 留在磁盘的实证材料逐条核对，结论见「特别核对项」）：✅ 通过

## 四项检查逐项结论

### 1. Commit 信息与编译测试验证 —— 通过

- `42f5f7f`（块 B web 11 文件）：message 分条对应交付面，中文、语义完整；文件级交付由收尾统一构建（与 impl §6 约定一致），`apps/web` 在当时即可独立 `tsc --noEmit && vite build`（web 不跨包 import，契约手抄）
- `d174784`（块 A 55 文件）：message 覆盖七个交付面（worker-core/worker-opencode/config/worktree/execution/perm/report/dispatcher/状态机/API/migration/测试）；「114 例全绿」= 7+9+98 三包口径，与 Checker 复跑一致；「S1 46 用例零破坏，唯一语义变更 = TASK 手推 system 边两处期望码改 MANUAL_FORBIDDEN」经逐文件核对属实
- `893e053`：合流 merge commit，无冲突（块 A/B 文件集不相交，符合 impl §6 切分）
- `99af591` + `48c798d`（探针 + revert）：见「特别核对项 · 保留 vs 清理」——**判断：保留**（历史真实性 > 分支整洁度，树状态已干净）
- `f513aee`（Oracle 收尾 5 文件）：message 列出五项根因与修法，与 diff 逐条对应，且显式记录「实证 commit 曾落主仓分支，已 revert」——审计链完备
- 独立可编译：HEAD 处三包 tsc + 三包 test + web build + frozen install 全绿；工作区干净无未提交残留（Checker 复跑后再次 `git status` 确认）
- 中间态说明：`d174784`/`42f5f7f` 各自包内自洽（块 A 的 perm 规则集与其单测期望一致；规则变更随 `f513aee` 同 commit 更新实现+测试，无「测试与实现分家」）

### 2. 代码质量迭代审查 —— 不通过（规则注入：TS/TSX；逐文件实读）

**worker-core（`events.ts` / `profile.ts` / `registry.ts`）**：事件联合类型与 spec §3.2 HarnessV1 命名逐项一致；`WorkerProfile` zod（id 正则 / protocol literal / capabilities 枚举 / timeoutMin 正整数）+ 推送 token 正则 `\b(push|remote)\b` + 五条凭据特征（前缀类 + 32 位随机串兜底）覆盖 MUST-3/MUST-6；`validateProfile` 顺序为「原文凭据扫描 → yaml 解析 → schema → 推送 token」，错误信息含来源文件与命中片段，可读；`loadRegistry` 目录缺失返回空注册表、id 冲突抛错。**通过**。

**worker-opencode（`map-events.ts` / `parse-line.ts`）**：四类映射与 spec §3.2 表逐行对齐（`text` 整段 → start + delta 全文一次 + end；`tool_use` → call + result，`state.status==='error'` → `errored=true`；`step_finish` → turn-end 携带 reason）；`finishFromExit` 仅退出码 0 产 finish；`parseLine` 非法行静默跳过（计数在 execution 侧）。**通过**。

**server 编排（`execution.ts` / `worktree.ts` / `perm-config.ts` / `report.ts` / `config.ts` / `dispatcher.ts`）**：
- `renderTemplate` 先拆 token 后整体替换（值含空格不二次拆分）→ 参数数组语义、不经 shell，无注入面（MUST-4 / §3.1 落实）；`spawn` 用 `detached: true` 使子进程成组长，超时 `kill(-pid)` SIGTERM→3s→SIGKILL 覆盖孙进程（B5 双 ESRCH 断言实证）
- 双 JSONL 每轮独立、`openSync('a')` append 不覆盖（MUST-5）、raw 首行/末行执行元数据（命令 / 注入摘要 / 基线 / 轮次 / 超时 / 退出码）
- worktree：路径在 `dataDir` 管理目录（不在目标仓内）、分支 `atd/t{id}`、复用分支/目录双分支、`prune` 幂等、回收 keepBranch 两分支（B8）——与 §3.8 一致
- perm-config：对象形态 + catch-all 在前、推送类 deny 后置覆盖（last-match-wins），双通道注入（`OPENCODE_CONFIG_CONTENT` 主 / `OPENCODE_CONFIG` 文件 fallback），规则集与 raw 注入摘要一致（B9 实测核验见下）
- **发现问题见文末清单 1/2/4/5**。

**前端（6 新组件 + 4 改动文件）**：
- `DispatchForm`：打开即重载 Registry（profile 可能随部署变化）、workerId 未选禁用提交、失败可重试，WORKER_REQUIRED/WORKER_UNKNOWN/WORKTREE_SETUP 由 api 层 toast 原样透出——与 §5 一致。**通过**
- `ReportCard`：DONE 显示 summary + commits（含轮次 Tag、sha 可复制），零 commit 有合法文案——与 §3.4「零 commit 合法」一致。**通过**
- `BlockerCard`：三裁决（continue / reassign 选 worker / abort）+ note 落 BLOCKER 留言 + 双视角渲染 + abort 警示 + 提交不可撤销提示——与 §5/§2 一致；父单入口死路径见问题 6
- `TransitionActions`：`userNextStatuses(type,status)` 与 server `isUserEdge` 逐边对齐（TASK 仅 4 条 user 边且放行走 DispatchForm；STORY 保留 S1 人工边；BLOCKER/DREAM 无常规出边），终态判定改用状态本身而非「按钮为空」（TASK 执行中落到 `autoAdvancing` 文案）——r3 的 L4（type 分流未贯通到前端）已实质闭合。**通过**
- `WorkerCard`：**UnifiedEvent 消费字段抽查（任务书「块 B 发现项 1」）——无运行时漂移**：只消费 `text-delta.text` / `tool-call.tool` / `tool-result.tool+errored` / `finish` 四种，字段名与 `packages/worker-core/src/events.ts` 实际形态一致；类型镜像有两处宽松化（见问题 7，仅类型保真度）
- `StatusTag` 八态 + `TicketListPage` 八态筛选 + type 筛含 BLOCKER（卡点队列）+ 建单类型收窄回 STORY/TASK（BLOCKER 不可手工创建）——与 §5 一致
- 注释规范：新代码中文注释、终态陈述、无历史/过程类词汇（grep「历史/之前/曾经/改为/撤销」仅命中「转移历史」这一时间线语义）、无 TODO/FIXME 残留。**通过（问题 1 的注释口径除外）**

### 3. 测试用例覆盖与回归 —— 通过

**B1-B9 锚点落实核对（impl §7 清单 vs 实读测试文件）**：

| # | 锚点 | 落实位置 | 断言实质 |
|---|---|---|---|
| B1 | 全链 DONE + commits 落库 + worktree commit 实存 | `dispatcher.test.ts:72-102` | `detail.commits` 等于 worktree 实际 HEAD、`rev-list --count=2`、产物文件存在、双 JSONL 落盘、raw 首行 meta —— 实质断言 |
| B2 | dataDir 只读 → 422 WORKTREE_SETUP 留 SPEC_READY | `api-s2a.test.ts:263-285` | chmod 0555 真实只读 + 状态未变 + 无 logs 产物（未 spawn） |
| B3a/b/c | 三裁决（abort/continue/reassign） | `dispatcher.test.ts:106-193` | BLOCKER 方向断言（父单 `dependencies` 含 BLOCKER 而非反向）、首条留言 = blockReason、abort→父 FAILED + BLOCKER DONE、continue→round=2 + r1/r2 双日志、reassign→`merge-base --is-ancestor` 分支延续 + 两轮产物共存 |
| B4 | 崩溃 → FAILED + 双 JSONL + 注入摘要 | `dispatcher.test.ts:197-219` | raw 首行 `permissionInjection.envKeys` 精确相等 + 文本含 `"git push":"deny"`/`"git remote *":"deny"` + 末行 exitCode=1 + 留言含「异常退出」 |
| B5 | 超时杀进程组 | `dispatcher.test.ts:223-252` | 孙进程 pid 文件 + 子/孙 **双 ESRCH** 轮询断言（非形式主义）+ raw 末行 timedOut=true |
| B6 | 报告缺失 L2 重试 → L3 | `dispatcher.test.ts:256-279` | round=2 可见 + BLOCKER 首条留言 authorType=system + 留言含最后一轮 raw 路径 + 两轮日志都在 |
| B7 | 注册防护 | `worker-core/profile.test.ts` 7 例 | 推送 token（push/remote 两形态）、sk-/glpat-/ghp_/xoxb-/32 位随机串、schema 缺字段、协议不识别逐条拒 |
| B8 | 回收两分支 + 执行中拦截 | `worktree.test.ts` 7 例 | allocate 复用同一路径 + `worktree list` 单挂载、keepBranch=true 分支留 commit 可达/再分配挂回、false 双删、IN_PROGRESS→422 且目录仍在 |
| B9 | 注入摘要可审计 | `perm-config.test.ts` 3 例 + B4 挂载 + 磁盘实证 | 规则集 `toEqual` 逐条 + 返回副本防篡改 + raw 首行实测含完整规则集 |
| B6 补充 | 重试耗尽型留言来源 | 同 B6 | 留言含「报告缺失/格式错误，重试 1 次后仍失败」+ raw 路径 |
| r1-L2 补 | pre-spawn 失败 / 重启恢复 | `dispatcher.test.ts:283-328` | 路径被普通文件占位 → CANCELLED + 留言；recoverOnStartup：TASK IN_PROGRESS→FAILED、DISPATCHED→CANCELLED、**STORY 人工态不受影响**（反向断言）|

**新增测试与既有测试交错核对**：`state-machine-s2a.test.ts` 覆盖 6 条新边各一例 + `test.each` 7 组 user 请求 system 边 → MANUAL_FORBIDDEN（含状态未变断言）+ 优先级锚点（不在边表 → INVALID_TRANSITION 而非 MANUAL_FORBIDDEN，对应 r2-N1/§1 判定优先级）+ STORY 人工边保留 + 三件套顺序（blockedBy 最优先于 WORKER_REQUIRED）——与 impl §1 写死的校验顺序逐条对齐。

**S1 46 基线核对**：`state-machine.test.ts` 20 + `ticket-service.test.ts` 15 + `api.test.ts` 11 = **46/46 通过**（Checker 单跑三文件实证）。M1 适配面与 impl §6 清单闭合：`api.test.ts` 的 4 处 system 边手推改为「断言 422 MANUAL_FORBIDDEN + `service.transition(...,{actor:'system'})` 补态」（收口回归锚点，未删断言）；`walkTo` 三处 helper 均按 type 分流补 workerId/system 通道；`blockedBy` 最优先期望码未动。**唯一两处期望码变更为设计内变更**（TASK DISPATCHED→IN_PROGRESS / IN_PROGRESS→DONE 手推 → MANUAL_FORBIDDEN），非掩盖式弱化。

**回归面**：改动为新增包 + 新增模块 + 既有状态机扩边；S1 七个测试文件全绿、web 既有组件（SpecCard/DependencyPanel/CommentStream/Timeline）未受影响、无共享文件冲突面。**通过**。

### 4. 设计文档归档与 AGENTS.md —— 不通过

- `spec.md` v4 + `impl.md` v3 已归档于 `.specpipe/plans/atd-s2a-worker-loop/`（随仓版本管理，推远端分支可见）；审查链 spec-r1/r2/r3 + impl-r1/r2/r3 + 本报告可追溯
- **实证修订未回写**（问题 3）：spec §3.1 的预置 command 仍为 `opencode run --format json --dir {{worktree}} {{prompt}}`（实交付 `opencode run --standalone --format json {{prompt}}`）；spec §6-MUST-2 行未记录 catch-all `allow`（无人值守）+ 后置 deny 的修订口径与主通道键名；impl §0 仍写 `{"*":"ask"}`、impl §4 仍写 `--dir` 模板——三处与 `f513aee` 后的实交付直接矛盾
- `README.md` 已更新（S2a 结构与四条命令），`workers/opencode.yaml` 头注释正确说明 prompt 全文注入 + spawn cwd 保证工作目录
- 项目根仍无 `AGENTS.md`（S1 质量门已建议，属独立工程动作，不计分）
- 兜底：B9 适用边界（MUST-2 只约束经 opencode 工具层的操作）已在 spec §7-B9 保留，未因修订丢失

## 发现的问题

### 1. `execution` 契约语义跨块背离——已执行工单永久「执行中」+ 自刷新循环（含 BLOCKER/STORY 误显执行卡） —— 严重程度：high

- 事实（双向实读 + 测试锚定）：
  - 服务端 `routes/tickets.ts:93-99`：`execution.startedAt` = 转移历史中**最后一次 `toStatus==='IN_PROGRESS'` 的转移时间**，一旦执行过就**永不返回 null**。`api-s2a.test.ts:98-112` 正是用一张 **DONE** 工单断言 `typeof body.execution?.startedAt === 'number'`，即该行为已被测试固定。
  - 前端 `api/types.ts:88-89` 注释与 `WorkerCard.tsx:48` 的实现把「非 null」当 running 判据（注释原文：「spawn 发起后非 null，进程结束置 null」）：`const running = execution != null`。
- 影响（静态推导，锚点确定）：
  1. 任何 round≥1 的 DONE/FAILED 工单详情页 → `running=true` → ① 显示橙色「执行中」标签；② `hasRound` 为真 → 每 5s 轮询 `GET /logs`；③ 历史事件流必含 `finish`（`execution.ts` 在退出码 0 时恒补记）→ 每次轮询都排一个 2s 后 `onChanged()` → **详情页每约 5s 自刷新一次，直到离开页面**（effect 依赖不变，interval 不会停）
  2. BLOCKER 单同样中招：`createBlocker` 落了一行 `DRAFT→IN_PROGRESS` 转移（`ticket-service.ts:468-477`），于是阻塞单页面 `execution` 非 null → 渲染「执行」卡并显示「执行中」；STORY 走人工 `DISPATCHED→IN_PROGRESS` 后同理
  3. 交付说明要求用户验收时「点开 DONE 工单看事件流尾部/报告卡」，该缺陷正落在验收路径首屏
  - 反证：`Dispatcher.getRunningInfo()`（`dispatcher.ts:50-53`，唯一能真回答「当前是否在执行」的来源）**全仓零调用**——接口已备而详情路由未接，说明这是接线遗漏而非有意口径
- 建议（任选其一，推荐 a）：
  - a) 服务端改为 `execution = runtime.dispatcher.getRunningInfo(id) ? {startedAt} : null`（或详情补独立字段），使 impl §2「当前轮 spawn 时间」与前端口径同时成立；同时 `api-s2a.test.ts:108` 断言改为按「运行中 vs 终态」分别断言
  - b) 前端收口：`running = execution != null && ticket.status === 'IN_PROGRESS'`，并把 WorkerCard 渲染门由 `workerId != null || execution != null` 改为 `ticket.type === 'TASK' && (workerId != null || round >= 1)`（消除 BLOCKER/STORY 误显）
  - 任一方案都需同步 `apps/web/src/api/types.ts` 的字段注释与 impl §2 契约行

### 2. spawn 发起失败（ENOENT 等）走 FAILED，与 spec §4「spawn 发起失败 → CANCELLED」不符，且终态不可恢复 —— 严重程度：medium

- 事实：`execution.ts:146-167` 把 spawn 错误（命令不存在 / 无执行权限，Node 异步 `error` 事件）解析为 `exitCode=null, spawnError`；`dispatcher.ts:188-199` 判为「worker 异常退出」→ **IN_PROGRESS→FAILED**。而 spec §4 明确「**pre-spawn 失败路径**（worktree 运行期建失败 / **spawn 发起失败** / 服务重启时 DISPATCHED 停留单）：单尚未进入 IN_PROGRESS，走 **DISPATCHED→CANCELLED** + system 留言「派发失败：<原因>，可重新放行」」，并注明「spawn 发起成功（**进程存在**）即 IN_PROGRESS」。
- 影响：worker 命令不可执行（profile 命令笔误、opencode 未装/被卸载、PATH 变化）时——`pid` 为 `-1`（`child.pid ?? -1`）即已可判「进程不存在」——工单落入 **FAILED 终态**（`TRANSITIONS.FAILED = []` 无出边，user 白名单亦无 FAILED 出边），失去 spec 设计的「可重新放行」恢复路径，只能改库。单用户本地场景触发概率低，但一次即卡死，且属 spec 明文偏离。
- 建议：`runOnce` 在 `startRun` 返回后先判 `run.pid > 0`（或在 `settle` 中用 `spawnError != null` 分支）走 pre-spawn 语义（DISPATCHED→CANCELLED + 留言），仅对「进程确实起来过」的异常走 FAILED；补一条 fixture（如 `node /nonexistent.mjs`）用例。若 Oracle 判定接受现状，须在 spec §4/§3.7 显式改写为「spawn 发起失败（含异步 ENOENT）→ FAILED」，消除双口径。

### 3. spec/impl 未回写 B1 实证修订——存档文档与实交付三处直接矛盾 —— 严重程度：medium

- 事实（实读 + grep `standalone|ask|--dir`）：
  - spec §3.1 预置 profile 模板仍是 `command: opencode run --format json --dir {{worktree}} {{prompt}}`；§6-MUST-2 行仍只写「permission deny 对象规则：bash 拒 `git*push*` 等」，未记录「catch-all allow（无人值守）+ 推送类后置 deny」的修订与 `OPENCODE_CONFIG_CONTENT` 主通道；§4 亦无 `--standalone` 与工作目录强约束的实证结论
  - impl §0 权限注入行仍写 `{"permission":{"bash":{"*":"ask",...}}}`；impl §4 预置 yaml 行仍写 `--dir {{worktree}} {{prompt}}`；§0「注入实证分工」仍停留在「真机实证归 Oracle 收尾 B1 真跑（记录生效键名进 impl 修订）」——实证已完成但结论未归档
  - `packages/worker-core/test/profile.test.ts` 的 `LEGAL` fixture 注释「与预置 opencode.yaml 同构」已失真（模板不同）
- 影响：impl 是后续维护/回归的编码事实源，**照 impl §4 修 profile 会立刻复现 r1-r5 的失败链**（`--dir` 不被本机 opencode 识别 → 打印 usage 退出）；工作目录强约束的成因（opencode 从 gitfile 解析项目根，曾致 commit 落主仓）是 S3/S2b 处理同类问题的前提知识，不回写即丢失
- 建议：随本 Story 归档补一节「B1 实证修订」（三处：权限规则集终稿 + 预置命令终稿 + 工作目录强约束成因与适用边界），同步 spec §3.1/§6 与 impl §0/§4 + profile.test.ts 注释；另建议顺带记录 spec 自身一处内部不一致的处置结论（§6-MUST-1 行「运行期失败走 FAILED」vs §4「运行期建失败 → CANCELLED」，实现按 §4）

### 4. `defaultTimeoutMin` 是死配置（声明、文档、yaml 三处可见，代码零消费） —— 严重程度：low

- 事实：`config.ts:16` 解析并给默认值 60，`spec.md:25` / `impl.md:60` / `config.yaml:7` / `README.md:17` 均列该项，但全仓无第二处引用——实际超时只取 `profile.timeoutMin`（schema 必填，`dispatcher.ts:108`）
- 影响：用户按文档调 `defaultTimeoutMin` 无任何效果，属误导性配置面；无功能损坏
- 建议：要么在 `profile.timeoutMin` 缺省时用它兜底（需 schema 放宽），要么在 config.yaml 注释与 impl 中显式标注「预留，当前未消费」，或直接移除

### 5. 判定表「stdout 无 finish」分支未实现——`hadFinish` 采集后未参与判定 —— 严重程度：low

- 事实：spec §3.2/§3.7 写「退出码非 0 / **stdout 无 finish 语义** → 执行失败」，而 `execution.ts:124-128` 在退出码 0 时**无条件补记** `finish(success=true)` 并置 `hadFinish=true`，`settle()`（`dispatcher.ts:179-199`）只看 `timedOut`/`exitCode`，`hadFinish` 仅落 raw 末行留痕
- 影响：静默退出码 0 的异常（worker 二进制被替换、输出被截断等）会走「报告缺失 → L2 重试 → L3 卡点」而非 FAILED；就 B6 锚点（fake-noreport 退出码 0 必须走 L2）而言实现口径是**正确且必要**的，偏差在文档侧
- 建议：把 §3.7 该行改写为「退出码非 0 → FAILED（崩溃，不重试）；退出码 0 而报告缺失/格式错 → L2 重试」，或恢复 `hadFinish` 的判定用途并给出用例——二选一，不留双口径

### 6. BLOCKER 单自身页的父单入口是死路径（`ticket.parentId` 恒 null） —— 严重程度：low

- 事实：`TicketDetailPage.tsx:166-169` 传 `parentTicketId={ticket.parentId ?? undefined}`，而 BLOCKER 单由 `createBlocker` 构造为 `parentId: null`（父子关系落在依赖表：父单 blockedBy BLOCKER，方向相反），且 `createTicket` 本就禁止非 TASK 带 parentId；`BlockerCard` 组件注释声称「BLOCKER 单自身详情页：卡内提供父单入口」——注释与实现不符
- 影响：从父单跳进 BLOCKER 单后无法一键跳回（浏览器后退或列表可绕行），无数据影响
- 建议：详情响应补父单信息（按依赖反向查）或在 `TicketDetail` 增 `blockerParentId` 字段；或删去该 prop 与注释中的双视角承诺

### 7. UnifiedEvent 类型镜像两处宽松化（运行时无漂移） —— 严重程度：low

- 事实：`routes/types.ts:42-46` 把 `reason` 挂到 `turn-start/turn-end/text-start/text-end` 联合上（worker-core 仅 `turn-end` 有 `reason`）；`apps/web/src/api/types.ts:136-145` 进一步把 `type` 放宽为 `... | (string & {})`、全部字段可选
- 影响：运行时消费无漂移（WorkerCard 抽查字段与 worker-core 实际形态一致，任务书「块 B 发现项 1」据此判定为**已闭合**），但镜像类型丧失保真度——服务端事件字段若改名，前端类型检查不会报错（S1 质量门曾以「镜像漂移」为核对项，同一标准下此处应记录为已知宽松）
- 建议：镜像收窄为与 `events.ts` 逐字同构（或抽 `@atd/worker-core` 类型依赖），若有意宽松须在注释写明动机

## 特别核对项结论（任务书预注）

### f513aee（Oracle 收尾修复）质量 —— 合格，五项逐条核验通过

| 修复项 | 核验方式 | 结论 |
|---|---|---|
| ① repoRoot 定位 | `index.ts:8` 上三级 = `<repo>/apps/server/src` → `<repo>`；对照 `db/client.ts` 的迁移目录定位（上两级 = `apps/server/drizzle`）自洽 | ✅（此前上两级会指向 `apps/`，`config.yaml` 必然缺失，与 r1-r5 现象一致）|
| ② `{{prompt}}` 内容化 | `dispatcher.ts:100` 注入 `readFileSync(promptPath)` 全文（单参数），prompt 文件仍落盘留档；128KB 上限有 `submitSpec` 硬校验兜底 | ✅（t7 raw 首行实证：command 含 prompt 全文，非路径）|
| ③ profile 去 `--dir` + `--standalone` | `workers/opencode.yaml:7`；t7 真跑 44s 产出 finish 事件，证明本机 opencode 接受该旗标且会话隔离 | ✅（`--standalone` 的必要性由 r4/r5 共享 server 会话串扰现象支撑，属合理工程判断）|
| ④ 权限规则 `ask→allow` + `edit/write allow` | `perm-config.ts` 终稿与 `perm-config.test.ts` 同 commit 更新；「返回副本防篡改」断言改写正确 | ✅（口径变更与无人值守语义自洽：ask 在无交互下等同拒绝，r4/r5 实证）|
| ⑤ buildPrompt 工作目录强约束 | `dispatcher.ts:377-397` 新增「最高优先级约束」段（绝对路径 / 禁其他目录 / gitfile 说明）；t7 实证 commit 落 `atd/t7` 而非主仓 | ✅（r5 事故的对照修复；建议按问题 3 把成因回写文档）|

附带检查：`f513aee` 未触碰前端与测试逻辑（仅 perm-config 单测随口径更新），无「为绿而改断言」痕迹；`readFileSync` 未加 try/catch，但 prompt 文件同函数内刚写入、失败会走 `preSpawnFail` 兜底，可接受。

### 99af591 + 48c798d 保留 vs 清理 —— **建议保留**（不扣分）

- 事实链：`99af591`（`apps/server/docs/b1-final.md`，内容「final probe ok」）是 B1 r5 轮 worker 因 opencode 从 gitfile 解析项目根、shell 工作目录错位而**误提主仓**的产物；`48c798d` 是 Oracle 的对照 revert。树状态干净（`git ls-files` 无探针文件、`apps/server/docs` 不存在、`git status` 无输出）
- 判断：**保留**。理由：① 该 commit 对是「工作目录约束」这条修复的**唯一原始实证**（revert 反证 + commit message 互指），单用户本地仓不存在对外协作的整洁度压力；② 抹除需改写已推远端的历史（force push），风险收益不成立；③ 作为 Story 归档的一部分反而完整
- 若用户偏好整洁：可在合并 main 前用 `rebase --onto` 摘除两笔（以 message 与 `f513aee` 正文描述替代证据），但**不建议**在用户验收前动历史

### `config.yaml` 的 `repoPath: .`（自吃本仓）作为默认值 —— 可接受，建议加一行护栏注释（不扣分）

- 合理面：单用户自吃（dogfooding）是最自然的首个目标仓——B1 真跑正是以本仓为 target 完成的（worktree `AgenticTicketDesk-s2a-tN`、分支 `atd/tN`），语义闭环；相对路径以 `config.yaml` 所在 repo 根解析，行为确定
- 风险面：目标仓 = 承载 server 的仓，一旦工作目录约束失效（r5 事故原型），worker 的写/commit 会落到开发者**当前签出分支**上（`99af591` 即此类）；`dataDir` 与 worktree 均在仓外，唯一暴露面就是这条
- 建议：保留 `.` 作为默认，但在 `config.yaml` 注释与 README 补一句「自吃场景请保持 ATD 工作区干净（worker 产物应只出现在 `atd/t{id}` 分支）」；可考虑运行期校验（spawn 前后比对主仓当前分支是否被推进，异常则 system 留言告警）——属 S3 可选增强，非本 Story 阻塞项

### B9 实证独立核验（磁盘材料，未重跑真机）—— 通过

- `~/.local/share/atd/logs/t7.r1.raw.jsonl` 首行：`command`（含 prompt 全文与「工作目录（最高优先级约束）」段）、`cwd = …/worktrees/AgenticTicketDesk-s2a-t7`、`round=1`、`baseline=0dd8b48…`、`timeoutMs=1800000`、`permissionInjection = {envKeys:[OPENCODE_CONFIG_CONTENT, OPENCODE_CONFIG], config:{permission:{bash:{"*":"allow","git push":"deny","git push *":"deny","git remote *":"deny","gh *pr*create*":"deny"},edit:"allow",write:"allow"}}}` —— **MUST-2 审计载体完整可见**
- `t7.r1.events.jsonl`：32 行统一事件（tool-call / turn-end / text …）+ 末行 `{"type":"finish","success":true}`；按 raw 时间戳推算总耗时 ~44s（与「50 秒 DONE」口径一致）
- `atd/t7` 分支存在于目标仓 + worktree 内 `atd-report.json`：`{"status":"done",...,"commits":["8928c29"]}`，`8928c29` 即 `docs/b1-r6.md`，且落在 **worker 自己分支**（非主仓）——r6 终局三要件（DONE / 产物在 worktree / 主仓零污染）逐条可验
- 主仓侧：`99af591`（+`48c798d` revert）证明 r5 事故真实发生；`atd/t1/t2/t4/t5` 分支与 `t*.r*.jsonl` 日志对留档完整；另有 `atd/t3`（`docs: B1 探针文件`）为早期轮次产物
- **提示**：验收后如需清理，`atd/t1`-`atd/t7` 分支与 `~/.local/share/atd/` 产物属设计内保留物，可用回收 API（keepBranch=false）或手工 `git branch -D` 处理；建议保留 `atd/t7` + t7 日志作为本次交付的证据样本

## 结论

# REJECT

状态：QUALITY_GATE → WORKING

一句话理由：编译/测试面全绿（Checker 独立复跑 114/114 + 三包 tsc + web build + frozen-lockfile，B1/B9 磁盘实证可逐条核验），但「`execution` 语义跨块背离」使任何已执行工单（含 DONE）的详情页误显「执行中」并进入每 5s 自刷新循环——正落在用户验收首屏路径上；另有 spawn 发起失败终态与 spec §4 不符、spec/impl 未回写 B1 实证修订两处 medium 与四处 low。修复面明确且局部（约 2 个文件 + 1 处测试 + 文档一节），修完可快速复核。
