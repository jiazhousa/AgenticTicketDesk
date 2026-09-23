# 审查报告: atd-s2a-worker-loop — Impl (Revision 3)

> **落盘说明**：仓内 `.specpipe/reviews/` 写入被权限白名单拒绝（session 外路径，与 r1/r2 同因），本报告落 `~/doc/.specpipe/reviews/atd-s2a-impl-review-r3.md`，由 Oracle 复制（归位）至 `/home/starlex/project/AgenticTicketDesk/.specpipe/reviews/atd-s2a-impl-review-r3.md`。

- 类型：Story Impl 完整审查（S-S8，三轮·终检）
- 对象：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2a-worker-loop/impl.md`（133 行，v3）
- 基准：同目录 `spec.md` v4（已放行，B1-B9 为唯一验收来源）、r2 报告 `reviews/atd-s2a-impl-review-r2.md`、**S1 仓现状（本轮逐文件实读核对）**：`src/domain/status.ts` / `ticket-service.ts` / `errors.ts` / `db/schema.ts` / `routes/tickets.ts` / `app.ts` / `index.ts` / 三个既有测试文件（`api.test.ts` 11 例、`state-machine.test.ts` 20 例、`ticket-service.test.ts` 15 例）/ `vitest.config.ts` / `apps/web/src/components/TransitionActions.tsx` / `.specpipe/fence.sh`
- 状态校验：工作流根 `.stage` = `IMPL_REVIEWING`（与任务书一致；`.stage-history` 第 14 条 = 调度者 14:45:20 转入）
- 日期：2026-09-23

## 总体评价

**通过（85 分）**。r2 的 1 medium + 5 low 已基本闭合，且 r2-high N1 的**语义面**已正确落地并可与实读代码逐处对账：

- **N1 主体闭合**：按 type 分流的通道二分（STORY 保留 S1 人工边全集；TASK 收口两组 system 边 + user 白名单 4 边 + `MANUAL_FORBIDDEN`）与 S1 编排流语义自洽——STORY 无执行、无 worker，其 `DISPATCHED→IN_PROGRESS→DONE` 本就该是人工边；TASK 收口动机（防手点造出无进程 IN_PROGRESS）成立。
- **N2 主体闭合**：`transition` 兼容策略（actor 缺省 'user'，S1 调用点零改动）、三件套校验顺序写死（① blockedBy ② workerId ③ worktree，与 S1 既有「blockedBy 最优先」期望码对齐，实读 `ticket-service.ts:280-282/396-412` 验证）、workerId 落库时点（该转移事务内）均已落纸。
- **N3①②、N4 主体、N5、N6④、N7 均已闭合**（逐项见下）。

**但** N1/N2 的配套面「S1 适配清单」仍有一处 **medium 级缺口**：`api.test.ts` 的 TASK 系统边 HTTP 手推（4 处断言）与 service 级 `walkTo` 的 TASK 放行步（workerId+registry）未入清单；按 §1/§6 字面实施，**「S1 既有 46 用例零破坏」不可达**（预计 6 处以上必红，取决校验落点）。另有 5 项 low 级文档残余（N3③④、N4 残余、N6 残余、type 分流边界未贯通、签名两处表述冲突）。全部为 3-5 行文档修订可解决，**无产品语义错误、无契约级硬伤**，故按评分门槛判 PASS，并把该 medium 作为「块 A 实施前的建议补丁」显式移交 Oracle/Builder。

## 质量评分

**85 / 100**（critical 0 / high 0 / medium ×1 = -5 / low ×5 = -10）

## r2 问题闭合核对（N1-N7）

| # | r2 问题 | v3 处置 | 判定 |
|---|---|---|---|
| **N1** | 通道二分未按 type 分流：STORY 流断裂 + S1 用例必红 | §1 明确 STORY 人工边全保留、TASK 收口两组 system 边；§6/§7 补 workerId 与 system 通道适配 | ⚠ **语义面闭合，配套面未闭合**：STORY 流与 `api.test.ts:67-70`（parent STORY 链）已自洽；但 TASK 侧适配清单遗漏调用点 → **M1** |
| **N2** | transition 适配清单缺 + 校验顺序未写死 + workerId 落库时点未定 | §1 写死① blockedBy→② workerId→③ worktree + 「workerId 落库时点=转移事务内」；§6 bullet1 定「actor 缺省 'user'，S1 调用点零改动」 | ⚠ 部分：顺序/落库时点 ✓；清单本身遗漏（M1）；签名两处表述冲突（**L5**） |
| **N3** | §2 契约细节四处含糊 | ① `round/pendingLabel` 已入 `ticket`（§2 行 47）✓；② `execution: {startedAt}` 已补 ✓；③「执行中/非终态」措辞未动；④ 128KB 校验端点仍未指明 | ⚠ 部分（①②闭合；③④ → **L1**） |
| **N4** | B5 断言载体弱（应验孙进程） | §7 改为「fake-sleep spawn 孙进程写 pid 文件…进程组全灭断言（child pid 与孙 pid 均 ESRCH）」 | ⚠ 主体闭合；宽限期注入/SIGKILL 分支/`vitest.config.ts` 全局 testTimeout 未落 → **L2** |
| **N5** | MUST-2 优先级边界未留档/实证 | §0 双落：边界声明（`OPENCODE_CONFIG_CONTENT` 优先级最高不被 project config 覆盖）+ 分工（Builder 落实 fallback 链，**Oracle 收尾 B1 真跑实证并记录生效键名**）——满足 r2「二选一」 | ✅ 闭合 |
| **N6** | 文档级残余六小项 | ④ dataDir 与 S1 `apps/server/data/` 关系 ✓（§0 行 22）；① zod 归属隐含于 §3 `report.ts` ✓；③ 部分（B6 留言 authorType=system 已写）；②⑤⑥ 未见 | ⚠ 部分（→ **L3**） |
| **N7** | B3b 轮次感知 fixture 机制缺失 | §7 写 `BLOCK_MODE` 环境变量参数化（首轮 blocked / 次轮 done，continue 后 round=2 写 done 报告可 DONE） | ✅ 闭合（备查：机制成立前提是 spawn env 继承 process.env——建议 §7 注明该前提，见 L2 附注） |

## r3 残余问题（须在块 A 实施前处置，或由 Oracle 转成 Builder 任务书附注）

### medium

**M1. S1 适配清单未逐点闭合——按字面实施「46 用例零破坏」不可达**（维度 2/4；v3 §1/§6）
- 证据（实读逐行核对）：
  1. **`api.test.ts` TASK 链的系统边 HTTP 手推未列**：`:57-58`（child1 `IN_PROGRESS`/`DONE` 期望 200）与 `:62-63`（child2 同）——v3 §1 明确 TASK 的 `DISPATCHED→IN_PROGRESS`、`IN_PROGRESS→DONE` 为 system 边、「user 请求 system 边 → 422 `MANUAL_FORBIDDEN`」，而 HTTP 端点无 actor 通道；§6 bullet2 只写了「SPEC_READY→DISPATCHED 补 workerId」，未覆盖这 4 处断言。
  2. **`:197`/`:215` 补 workerId 后引入 dispatcher 异步触发，断言时序未定义**：`:215` 用例在放行后立即断言 `detail.transitions` 长度=2（`:217`）——若 dispatcher 在测试 app 内被装配并异步 spawn，`DISPATCHED→IN_PROGRESS` 行可能抢先落库造成抖动；若未装配，则需写明 S1 测试用 noop/stub dispatcher 的装配方式（`buildApp` 现签名仅 `(db)`，`app.ts:14-19`）。
  3. **service 级 `walkTo` 的 TASK 放行步未写 workerId**：spec §4 定三件套「与 blockedBy 门同级」→ 主读法是**在 `TicketService.transition` 内**（`ticket-service.ts:277-285` 现位置）；则该层校验 TASK 放行必填 workerId∈Registry 后，`state-machine.test.ts:7-21` walkTo、`ticket-service.test.ts:6-21` walkTo 及 `makeFamily` 中**所有 TASK 走位**（含 `state-machine.test.ts:36` 合法边行的 `SPEC_READY→DISPATCHED` 直推）都需传 fixture workerId + 注册表预载——§6 bullet3 只写了 system 通道参数，未写 workerId；`helpers.ts` 未列入适配清单（fixture 预载只在 api.test bullet 的括号里带过）。
  4. **`MANUAL_FORBIDDEN` 与 `INVALID_TRANSITION` 的判定优先级未写死**：S1 有 8 处非法边期望 `INVALID_TRANSITION`（`state-machine.test.ts:54-73`，含 `DRAFT→DISPATCHED`、`IN_PROGRESS→CANCELLED` 等）。若实现把「通道判定」置于「边集判定」之前，这些非法边将返回 `MANUAL_FORBIDDEN`（不在 user 白名单）→ 全红。§6 bullet4「校验顺序按 §1 写死」只覆盖①②③三件套。
- 影响：按字面实施块 A：`api.test` 至少 3 个用例红；若校验落在 service 层，state-machine/ticket-service 两文件 30+ 用例的 walkTo 放行步连带红；且 Builder 被迫自行发明适配方式，存在「删断言/弱化断言求绿」的静默走偏面——恰是 r2 设立适配清单要防的失效模式。
- 建议（3-5 行即可）：
  1. §6 补一条：`api.test.ts` 的 TASK 系统边（`:57-58`/`:62-63`）改走 system 通道（**二选一并写死**：a) `service.transition(id,'IN_PROGRESS'|'DONE','system')` 直调；b) 由 fixture dispatcher 驱动并对断言改为等待终态）；若选择移除手推路径，注明该段由 `dispatcher.test.ts` 覆盖（r2-N1 建议②原文）。
  2. §6 补一条：S1 测试装配用 noop/stub dispatcher（或 `buildApp(db, { dispatcher })` 注入位），并保证 `:217` 的长度断言不受异步影响。
  3. §6 补一句：`helpers.ts` 的 `createTestContext` 支持 fixture workers 目录预载（暴露注入位），TASK 走位统一带 fixture workerId；点名 `state-machine.test.ts:36` 行也在适配面内。
  4. §1 补一行判定优先级：`USE_SPEC_ENDPOINT` > `INVALID_TRANSITION`（边集）> `MANUAL_FORBIDDEN`（通道）> blockedBy > workerId > worktree——保证 S1 8 处非法边期望码不变。

### low

**L1. N3③④ 未闭合**（维度 2；v3 §2/§3）
- ③ 回收前置仍写「执行中/非终态 → 422 `WORKTREE_ACTIVE`」：「执行中」与「非终态」是包含关系，且未放行单无 worktree 时的回收语义未定（B8 只要求执行中拦截）。
- ④ 「prompt 超长（>128KB）422」出现在 §3 `routes/*` 与 §7 api-s2a，仍未指明校验端点（提交 spec / 放行 二选一）。
- 建议：§2 写死「回收仅允许非执行中（IN_PROGRESS→422；其余非终态按无 worktree 处理，返回 404/NOT_FOUND 或 422 二选一写明）」；128KB 端点写死。

**L2. N4 残余**（维度 3；v3 §0/§7）
- SIGTERM 宽限期（3s）不可注入（`timeoutOverrideMs` 已有，宽限期无对应注入位）、SIGKILL 分支无验证路径（现有 fixture 对 SIGTERM 即死，只验到 SIGTERM 段）、`vitest.config.ts` 全局 testTimeout 未提及（仅 dispatcher.test 文件级 30s，可接受但未写明）。
- 附注（N7 机制前提）：`BLOCK_MODE` 生效依赖 spawn env 继承 `process.env`（或显式透传）——建议 §7 注明前提，防 execution.ts 白名单式构造 env 时静默失效。
- 建议：`timeoutKillGraceMs` 注入位 + 「忽略 SIGTERM 的 fixture 验 SIGKILL」一条用例；§7 补 env 传递前提一句。

**L3. N6 残余**（维度 2/4；v3 §0/§3/§7）
- ② 每轮产物路径（`{dataDir}/logs/t{id}.r{n}.{raw,events}.jsonl`）未在 §3 复述（spec §3.2 有）；
- ⑤ `config.yaml`「启动缺失则报错」未复述；
- ⑥ 「模板校验只作用于 profile 原文，不对渲染后命令重复校验」未写；
- ③ BLOCKER 首条留言 authorType 未定（B6 已写 system；r2 曾建议「BLOCKER 首条=agent、派发失败/重启中断=system」——两口径可，但建议统一写明）。
- 建议：§3/§0 各补一行即可。

**L4. type 分流语义未贯通到边界消费方**（维度 1/3；v3 §3/§5）
- §5 只写「TransitionActions 收口为 user 白名单边」——未按 r2-N1 建议③明示**按 `ticket.type` 渲染**（TASK 仅 CANCELLED+放行弹层；STORY 保留人工按钮）；括注「MANUAL_FORBIDDEN toast 原样透出」反而暗示按钮可能照旧渲染系统边。
- §3 `onDispatched` / `recoverOnStartup` 未写「仅 TASK（执行单）」触发条件——STORY 放行不应触 spawn（`api.test.ts:67` STORY 放行若误触 spawn 尝试会连带红）、STORY 处于 DISPATCHED 时重启不应被误 CANCELLED。
- 建议：§5 一句「NEXT_STATUSES 按 type 取 user 白名单」；§3 两处补「仅 TASK」。

**L5. §1 与 §6 的 transition 签名表述冲突**（维度 2）
- §1：`transition(ticketId, to, { actor: 'user'|'system', ... })`（对象形态）；§6：「签名加 actor 参数（缺省 'user'）——S1 全部调用点零改动」（位置形态）。二者不能同时成立（对象形态下 `service.transition(id,to,'user')` 20+ 处 TS 报错）。
- 建议：择一写死（推荐位置形态：`transition(id, to, actor: 'user'|'system' = 'user', note?, workerId?)`，与「零改动」自洽），或写明 union/overload 兼容读法。

## B1-B9 终检（锚点/可执行性）

| # | impl v3 锚点 | 判定 |
|---|---|---|
| B1 | `dispatcher.test.ts` fake-done 全链（DONE+commits 落库+worktree commit 实存）；§8 真实 opencode 真跑 | ✅ |
| B2 | 放行前置③ + `WORKTREE_SETUP`；「dataDir 只读→422 留 SPEC_READY」 | ✅ |
| B3a/b/c | fake-blocked（`BLOCK_MODE`）→BLOCKED+BLOCKER（方向断言）+三裁决分支；reassign 换 profile 分支延续 | ✅（机制已定义，前提见 L2 附注） |
| B4 | fake-crash→FAILED+双 JSONL+raw 首行元数据（含注入摘要） | ✅ |
| B5 | fake-sleep+孙进程 pid+override 300ms→FAILED+双 ESRCH | ✅（残余增强见 L2） |
| B6 | fake-noreport→round=2→L3 BLOCKER 留言含 raw 路径、authorType=system | ✅ |
| B7 | `profile.test.ts` 推送 token 拒/凭据拒/合法过 | ✅ |
| B8 | `worktree.test.ts` 复用/reclaim 两分支/执行中 `WORKTREE_ACTIVE` | ✅ |
| B9 | `perm-config.test.ts` 逐条断言规则集 + raw 首行注入摘要（挂 B4） | ✅ |

MUST 速核：MUST-1 ✅ / MUST-2 ✅（对象形态+主通道，边界已留档）/ MUST-3 ✅ / MUST-4 ✅ / MUST-5 ✅ / MUST-6 ✅（本轮无回归）。

## S1 回归面事实核对（实读）

- **用例计数**：`state-machine.test.ts` 20 + `ticket-service.test.ts` 15 + `api.test.ts` 11 = **46** ✓，与 impl §0/§6「S1 既有 46 用例」及 S1 归档 commit（「质量门 93 + 发现项修复 46/46」）一致。
- **受影响调用点逐条**（通道二分/三件套落点）：
  - `api.test.ts`：`:47`（TASK 放行被 blockedBy 拒 → 期望码不变 ✓）、`:56/:61`（TASK 放行 → 需 workerId，清单✅）、`:57-58/:62-63`（TASK 系统边手推 → **清单遗漏，M1**）、`:67-70`（STORY 人工边 → 保持 ✓）、`:197`/`:215`（TASK 放行 → 需 workerId + 异步时序，**部分遗漏，M1**）。
  - `state-machine.test.ts`：全文件工单均为 TASK（`:26` 等）；`:18` walkTo 与 `:36/:45/:49` 合法边行、`:66/:68` 非法边行、`:82/:84` SPEC_READY 行、`:99/:102/:106` 终态行——system 通道已列、**workerId/注册表与优先级未列，M1**。
  - `ticket-service.test.ts`：`:6-21` walkTo 与 `:24-40` makeFamily（TASK 子单走位）、四个 STORY 聚合门用例（STORY 人工边，保持 ✓）。
- 结论：清单覆盖度 ≈「STORY 面 100% + TASK 面 60%」；补齐 M1 四小点后 46 用例零破坏可达。

## 结论

# PASS

状态：IMPL_REVIEWING → IMPL_APPROVED

一句话理由：r2 的 N1/N2 主体与 N3①②/N4 主体/N5/N6④/N7 均已实质闭合、B1-B9 全部有可执行锚点、S1 回归面经逐行核对仅余清单遗漏（M1，medium）与 5 项文档级 low——按评分门槛 85/100 判 PASS，建议 Oracle 在派发块 A 前把 M1 的 3-5 行补丁并入 §1/§6（或作为 Builder 任务书附注），其余 low 可随编码顺带收口。
