# 审查报告: atd-s2a-worker-loop — Impl (Revision 2)

> **落盘说明**：仓内 `.specpipe/reviews/` 写入被权限白名单拒绝（session 外路径，与 r1 同因），本报告落 `~/doc/.specpipe/reviews/`，由 Oracle 复制（归位）至 `/home/starlex/project/AgenticTicketDesk/.specpipe/reviews/atd-s2a-impl-review-r2.md`。

- 类型：Story Impl 完整审查（S-S8，二轮）
- 对象：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2a-worker-loop/impl.md`（127 行，v2）
- 基准：同目录 `spec.md` v4（已放行，B1-B9 为唯一验收来源）、`plans/agentic-ticket-desk/epic-spec.md` v4、r1 报告 `reviews/atd-s2a-impl-review-r1.md`、S1 仓现状（本轮实读核对：`status.ts`/`ticket-service.ts`/`routes/tickets.ts`/`schema.ts`/`index.ts`/`vitest.config.ts` 与三个既有测试文件、web `TransitionActions.tsx`/`TicketListPage.tsx`/`api/types.ts`）
- 状态校验：工作流根 `.stage` = `IMPL_REVIEWING`（与任务书一致）
- 日期：2026-09-23

## 总体评价

**不通过（73 分）**。r1 的 1 high + 3 medium 主体均已实质修复，且修订质量高：MUST-2 对象形态权限 + `OPENCODE_CONFIG_CONTENT` 主通道 + B9 专属逐条单测（原 H1 闭合）；BLOCKER 关联方向与 resolve 三步顺序已固化，且与实读代码 `ticket-service.ts:280-282/396-412`（`assertDependenciesDone` 只在 `ticketId` 一侧、仅 `to=DISPATCHED` 检查）完全自洽（原 M1 闭合）；`timeoutOverrideMs` 测试注入 + ESRCH 断言 + 30s testTimeout（原 M2 主体闭合）；转移通道二分 + workerId 限 TASK（原 M3 方向正确）。

但通道二分在**未按工单类型分流**的条件下引入一处未闭合断层：STORY 纯编排流被切断，且 S1 既有用例大面积必红——与 v2 自设验收前提「S1 既有 46 用例零破坏」自相矛盾（high）。另有 transition 签名变更的 S1 适配清单缺失（medium，与前者同区域）与 5 项文档级残留（low）。均为文档级修订，rev3 预计半日内可完成。

## 质量评分

73 / 100（critical 0 / high ×1 = -12 / medium ×1 = -5 / low ×5 = -10）

## r1 问题闭合核对（1H + 3M + 6L）

| # | r1 问题 | v2 处置 | 判定 |
|---|---|---|---|
| H1 | MUST-2 注入形态非法（`bash.deny` 数组）+ 通道可被 project config 覆盖 + B9 无专属断言 | §0 改为对象形态 `{"permission":{"bash":{"*":"ask","git push":"deny",…}}}`（catch-all 在前、last-match-wins），主用 `OPENCODE_CONFIG_CONTENT`（内联 JSON、优先级最高）；§3 新增 `perm-config.ts`（导出常量+`buildPermJson()`）；§7 `perm-config.test.ts` 逐条断言规则集【B9 后半句】；注入摘要写 raw 首行 | ✅ 主体闭合；r1-H1④（B1 真跑补「worktree 预置放宽 `opencode.json` → deny 仍生效」实证或记录优先级边界）未落 → N5 |
| M1 | BLOCKER 关联方向未固化 + resolve 顺序反例（B3c 恒 422） | §2 写死「行=（父单.id, blocked_by=BLOCKER.id）」+ resolve 三步顺序（①note ②BLOCKER→DONE ③按裁决转父单，「BLOCKER 已 DONE，父单 blockedBy 依赖门天然放行」）；§7 B3 含「blockedBy 方向断言」 | ✅ 完全闭合（实读代码验证：方向与 `assertDependenciesDone` 行为一致；顺序正确，否则 `BLOCKED→DISPATCHED` 必被 `BLOCKED_BY_PENDING` 拦） |
| M2 | B5 超时机制递延 + 未断言杀进程树 + vitest 超时未配置 | §0 决策行「profile `timeoutMin` 正常语义；dispatcher 构造参数 `timeoutOverrideMs`（仅测试注入）；B5：fake-sleep + override 300ms」；§7「FAILED+**进程组已死断言**（child pid ESRCH）」+「文件级 testTimeout=30s」 | ⚠ 主体闭合；断言载体仍弱（只写 child pid ESRCH，未采纳 r1 的「孙进程 marker 不产生」载体——`sleep` 类 fixture 区分不了「杀进程组」与「只杀子进程」）；SIGTERM 宽限期（3s）未可注入、`vitest.config.ts` 全局未提 → N4 |
| M3 | 用户可触达边未收口（手点「开始执行/完成关单」砖化工单） | §1 转移通道二分（user 白名单 4 边 / system 内部边）+ `MANUAL_FORBIDDEN`；§5 `TransitionActions` 收口 | ⚠ 方向正确但**引入新断层**：未按 type 分流，STORY 编排流断裂 + S1 用例必红 → N1 |
| L1 | §2 契约残留四小项 | ①report=最大 round ✓ ②logs 缺省=当前轮 ✓ ③workerName 层级（顶层）✓ ④产物路径/`atd-report` zod 归属未写；workerId 落库时点仍未写（r1 点过） | ⚠ 部分（④+落库时点 → N2/N6） |
| L2 | pre-spawn 失败与重启恢复薄、零锚点 | §3 `recoverOnStartup()`（IN_PROGRESS→FAILED / DISPATCHED→CANCELLED + 留言）；§7「pre-spawn 运行期失败→CANCELLED+留言；recoverOnStartup 造数两态分流」 | ✅ 闭合；`addComment` 的 authorType 三型（system/agent/user）未定 → N6 |
| L3 | 新前置校验的既有测试回归面未列 | §6 块 A「S1 用例适配：api.test 全链的 TASK 放行补 workerId（helper 预载 fixture）」；§7 api-s2a「S1 回归…全绿」 | ⚠ **部分**：只点名 api.test 的 workerId；未覆盖 ①STORY/TASK 手推 IN_PROGRESS/DONE 被通道二分堵死（N1）②`transition` 签名变更对 service 级 20+ 调用点的适配 ③校验顺序未写死（r1 明确要求）→ N2 |
| L4 | 测试基建细节（轮次感知 fixture/绝对路径/注入/双 JSONL） | 绝对路径 ✓（§6「fixture 绝对路径写入」）；临时 profile 注入 ✓；B4 双 JSONL ✓；**轮次感知机制未落** | ⚠ 部分（→ N7） |
| L5 | 定位基准与工程装配（config 基准/dataDir/fence/drizzle name） | config 以 repo root 为基准 ✓（§0）；`fence.sh` 入 A 文件集 ✓（§6）；migration `0001_s2a` ✓；dataDir 与既有 `apps/server/data/atd.db` 的关系未写 | ⚠ 部分（→ N6） |
| L6 | 模板替换与参数边界 | 先拆 token 后替换 ✓（§0）；prompt >128KB→422 ✓（§3）；「勿对渲染后命令重复校验」未写 | ⚠ 部分（→ N6） |

## B1-B9 锚点复核

| # | impl v2 锚点 | 判定 |
|---|---|---|
| B1 | `dispatcher.test.ts` fake-done 全链（DONE+commits 落库+worktree commit 实存）；§8 真实 opencode 真跑 | ✅ |
| B2 | 放行前置③ + `WORKTREE_SETUP`；「dataDir 只读→422 留 SPEC_READY」 | ✅ |
| B3a/b/c | fake-blocked→BLOCKED+BLOCKER（方向断言）+blockReason；三裁决分支各一用例；改派「换 profile 分支延续（git log 保留 r1 commits）」 | ✅ 方向与顺序已固化；B3b 续跑 DONE 缺轮次感知机制（N7） |
| B4 | fake-crash→FAILED+双 JSONL+raw 首行元数据 | ✅ |
| B5 | fake-sleep+override 300ms→FAILED+ESRCH | ✅（断言载体弱，N4） |
| B6 | fake-noreport→round=2→L3 BLOCKER 留言含 raw 路径 | ✅ |
| B7 | `profile.test.ts` 推送 token 拒/凭据拒/合法过 | ✅ |
| B8 | `worktree.test.ts` 复用/reclaim 两分支/执行中 `WORKTREE_ACTIVE` | ✅ |
| B9 | 后半句：`perm-config.test.ts` 逐条断言规则集（含 bash 对象与 `git push` deny）；前半句：raw 首行注入摘要（挂 B4） | ✅ |

MUST 速核：MUST-1 ✅ / MUST-2 ✅（形态+通道已按官方口径修正）/ MUST-3 ✅ / MUST-4 ✅ / MUST-5 ✅ / MUST-6 ✅。

## 新发现问题

### high

**N1. 转移通道二分未按 type 分流：STORY 编排流断裂 + 「S1 46 用例零破坏」不成立**（维度 1/3/4；spec §3.5、§4 语义注记；v2 §1/§5/§6）
- 证据（实读 S1 代码逐处核对）：
  - `status.ts:17-24` 现有 `TRANSITIONS` 中 `DISPATCHED→IN_PROGRESS`、`IN_PROGRESS→DONE` 是 S1 编排流的两条主干边；v2 §1 将「进出 IN_PROGRESS 的全部」划归 system 边（仅 dispatcher/resolve 内部调用），user 白名单（4 条）不含这两条。
  - `api.test.ts:56-63`（child1/child2，**TASK**）与 `:67-70`（parent，**STORY**）经 HTTP `POST /transition` 手推 IN_PROGRESS/DONE——HTTP 请求无法携带 actor，按 v2 字面实现一律 422 `MANUAL_FORBIDDEN`。
  - `ticket-service.test.ts`（walkTo :6-21，及 :33/:47/:61/:69/:78/:90/:103）与 `state-machine.test.ts`（walkTo :7-21，及 :38-40/:45/:68/:84/:106）以 `service.transition(id, to, 'user')` 直调，同样撞 system 通道校验。
  - `index.ts`/`app.ts` 现状：无任何内部触发者能推进 STORY 的这两条边（dispatcher 只服务有 worker 的执行单；STORY 无 worker、不 spawn），v2 §3 `onDispatched` 亦未定义 STORY 分支。
- 影响：
  1. **块 A 验收前提自相矛盾**：v2 §0/§6 声明「S1 既有 46 用例零破坏」，但按 §1 字面实现至少十余处必红（api.test 两条链路 + 两个 service 级测试文件的 walkTo）；
  2. **产品流程断裂**：STORY 放行后无任何可达通道推进到 IN_PROGRESS→DONE（UI 按 §5 收口后连按钮都没有），S1 的 A1「STORY+2 子 TASK 全链闭环」在新语义下不可达；
  3. r1-M3 的收口动机（防手点造出无进程 IN_PROGRESS）只对 **TASK** 成立——STORY 是纯编排、本就无进程，无需收口。
- 建议（写进 §1/§5/§6/§7 收口）：
  1. 通道二分**按 type 分流**：TASK 走收口（DISPATCHED→IN_PROGRESS、IN_PROGRESS→{DONE,BLOCKED,FAILED} 仅 system）；STORY **保留 S1 人工边**（DISPATCHED→IN_PROGRESS、IN_PROGRESS→DONE 为 user 可达，放行不需 workerId）；
  2. §6 块 A 的 S1 适配清单扩为逐点：`api.test.ts:56-63/:67-70` 的推进调用、`state-machine.test.ts`/`ticket-service.test.ts` 的 walkTo 与 service 级调用点（签名/actor 处置）——若 TASK 手推路径在测试中被移除，需注明该段由 `dispatcher.test.ts` 覆盖；
  3. web 侧 `TransitionActions` 的 `NEXT_STATUSES` 按 `ticket.type` 渲染（TASK 仅 CANCELLED+放行弹层；STORY 保留人工按钮），并在 §5 明示。

### medium

**N2. `transition` 签名变更的适配面缺清单 + 三件套校验顺序未写死 + workerId 落库时点未定**（维度 2/4；v2 §1/§2/§6）
- 证据：① v2 §1 将签名改为 `transition(ticketId, to, { actor, … })`，而既有 service 级调用点 20+ 处（两个测试文件 walkTo 及多处直调）+ HTTP 调用点 1 处（`routes/tickets.ts:103`）均为 `transition(id, to, operator, note?)` 位置参数形态；v2 §6 适配话术只提「api.test 全链的 TASK 放行补 workerId」，未覆盖签名/通道变更的适配策略（兼容旧签名 vs 全量改调用点）。② spec §4 三件套编号 ①worker_id ②blockedBy ③worktree；v2 未写死校验先后——若 workerId 校验先于依赖门，`api.test.ts:47`（期望 `BLOCKED_BY_PENDING`、无 workerId）返回码将变 `WORKER_REQUIRED`，r1 已点出的 6 处清单（`:47/56/61/67/197/215`）需明确每处如何处置。③ `worker_id` 由谁在何时落库（transition 入参透传？§1 签名的「…」是否含 workerId？）未写——直接决定 B1 真跑与 §7 断言口径。
- 建议：§6 增「S1 调用点适配清单」（逐文件逐点）+ §2 补「校验顺序按 spec 编号 ①→②→③，错误码优先级同序」+ §1 补「workerId 经 transition options 落库 `tickets.worker_id`（system 边 reassign 同口径）」。

### low

**N3. §2 契约细节四处含糊**（维度 2）
- ① `GET /api/tickets/:id` 响应把 `round`/`pendingLabel` 列在**顶层**（与 `workerName` 并排），但二者是 `tickets` 表列、`toTicket` 展开后必然已存在于 `ticket` 对象内——B 块手抄 `types.ts` 时层级错配只会在运行期表现为 undefined；
- ② §5 `WorkerCard` 需要「启动时间」，§2 契约无对应字段（`round` 有，启动时间无来源）；
- ③ §2「DELETE /worktree：执行中/非终态 → 422 `WORKTREE_ACTIVE`」——「执行中」与「非终态」是包含关系，措辞含混（B8 只要求执行中拦截；未放行单无 worktree，回收语义未定）；
- ④ §3「prompt 超长（>128KB）422」未指明校验端点（提交 spec 时？放行时？）。
- 建议：§2 补字段层级示例（`ticket.round`/`ticket.pendingLabel` + 顶层 `workerName`/`startedAt` 或复用 raw 首行时间）、明确回收前置条件、指明 128KB 校验端点。

**N4. B5 进程组断言的验证载体仍弱**（维度 3；spec B5「杀进程树」）
- v2 只写「child pid ESRCH」：若 fixture 是单层 `node fake-sleep.mjs`，杀进程组与杀子进程不可区分；r1 建议的「孙进程 marker 不产生 + kill(pid,0) ESRCH」严格载体未采纳。另「SIGTERM 宽限期（3s）可注入」未写，SIGKILL 分支无验证路径；`vitest.config.ts` 全局 testTimeout 亦未提（只在 dispatcher.test.ts 文件级）。
- 建议：fixture 造孙进程（marker 文件断言不产生）+ 宽限期注入短值各补一条。

**N5. r1-H1④ 未落：MUST-2 优先级边界的实证/记录缺失**（维度 1）
- v2 §8「B1 真跑」仅「真实 opencode profile+临时 git 仓：写文件+commit 全链」，未含 r1 建议的「worktree 预置放宽 permission 的 `opencode.json` 后 deny 仍生效」实证步骤，也未记录该优先级边界（`OPENCODE_CONFIG_CONTENT` > project config）作为适用条件留档。
- 建议：§8 补一行实证步骤或 §0 补一行边界声明（二选一即可）。

**N6. 文档级残余收口六小项**（维度 2/4）
- ① `atd-report.json` 的 zod schema 归属未定（worker-core 供复用 vs server 私用）；② `{dataDir}/logs/t{id}.r{n}.{raw,events}.jsonl` 产物路径未在 §3 复述（spec §3.2 有）；③ `addComment` 的 authorType 使用场景未定（schema 注释已备 `user|agent|system` 三值，服务层现固定 `user/我`；建议：派发失败/重启中断=system、BLOCKER 首条=agent）；④ `config.dataDir` 与 `index.ts:6` 既有 `dataDir` 变量（`apps/server/data/`，dev 库 `atd.db` 所在）**同名不同义**，未声明二者关系（避免误移库/误清库）；⑤ config.yaml「启动缺失则报错」未复述；⑥「勿对渲染后命令重复校验模板」未写。
- 建议：§3/§4 各补一行即可，不阻塞。

**N7. B3b 的轮次感知 fixture 机制缺失**（维度 2/可执行性；r1-L4① 未闭合）
- v2 §7 B3b 断言「continue round=2 原 worktree→DONE」，但 `continue` 复用**同一** fake-blocked profile，round=2 必然再次 blocked——`→DONE` 不可按字面实现；§6 fixture 清单五脚本（fake-done/blocked/crash/sleep/noreport）不含轮次感知机制。若不写死，Builder 有静默误实现面（例如让 resolve 换 profile → 测试绿但掩盖「继续=原 worker」语义）。
- 建议：明确机制（推荐 worktree 内残留 marker 判定首/次轮）或补一个轮次感知 fixture 脚本，并在 §7 B3b 行注明判定依据。

## 结论

# REJECT

状态：IMPL_REVIEWING → IMPL_DRAFT

一句话理由：r1 的 H1/M1/M2 主体已高质量闭合，但新的转移通道二分未按 TASK/STORY 分流——STORY 编排流（DISPATCHED→IN_PROGRESS→DONE）无任何可达通道、S1 既有用例十余处必红（「46 用例零破坏」前提自相矛盾），需与 transition 签名适配清单（medium）及 5 项文档级残留一并修订后过审。
