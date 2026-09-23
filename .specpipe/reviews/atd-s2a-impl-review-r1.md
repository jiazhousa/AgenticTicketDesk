# 审查报告: atd-s2a-worker-loop — Impl (Revision 1)

- 类型：Story Impl 完整审查（S-S8）
- 对象：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2a-worker-loop/impl.md`（136 行）
- 基准：同目录 `spec.md` v4（已放行，B1-B9 为唯一验收来源）、`plans/agentic-ticket-desk/epic-spec.md` v4（§5 状态机 / §6 MUST 六条 / §9 S2a 行）、S1 仓现状（main 已合核心域：六态/八端点/4 个测试文件，`packages/` 尚不存在）
- 外部事实核对：opencode 官方文档 `docs/permissions`、`docs/config`（permission 形态与配置优先级，2026-09-23 抓取）
- 状态校验：工作流根 `~/doc/.specpipe/plans/atd-s2a-worker-loop/.stage` = `IMPL_REVIEWING`（与任务书一致）
- 落盘说明：本报告因 checker 权限白名单路径形态限制（`../project/**/.specpipe/reviews/**` 条目对 session 外文件不生效），先落 `~/doc/.specpipe/reviews/`，由 Oracle 复制至仓内 `.specpipe/reviews/`
- 日期：2026-09-23

## 总体评价

不通过——总体骨架、技术方向与 spec 覆盖主干成立（双包切分、fake profile 测试主线、spawn 参数数组 + detached 进程组、判定表与 B1-B9 锚点表基本齐全），但有 **1 处 MUST 级注入载体的形态/通道偏差（high）** 与 **3 处开工前需收口的实质空白（medium：BLOCKER 关联方向与 resolve 事务顺序 / B5 超时机制递延且未验证「杀进程树」/ 用户手动转移入口与新语义冲突）**；另有 6 处文档级收口。均为文档级修订，预计 rev2 一小时内可完成。

## 质量评分

61 / 100（critical 0 / high ×1 = -12 / medium ×3 = -15 / low ×6 = -12）

## 逐维度结论

| # | 维度 | 结论 | 要点 |
|---|---|---|---|
| 1 | spec 覆盖 | 部分通过（1 high + 2 medium + 1 low） | B1/B2/B3a-c/B4/B6/B7/B8 均有测试锚点；MUST-3/4/5/6 有落地（模板校验 + 凭据扫描、spawn cwd 锁 worktree、每轮双 JSONL、零凭据 profile）。缺口：B9 后半句无专属锚点（H1）、B5 机制递延（M2）、spec §4 的 pre-spawn 失败与重启恢复路径落地过薄（L2）、spec §3.6 BLOCKER 关联方向未固化（M1） |
| 2 | 可执行性 | 部分通过（1 high + 1 medium + 3 low） | 两块文件集确实不相交（唯一交接面 `apps/web/package.json` 有条件化处理），fake profile 覆盖 done/blocked/崩溃/缺报告四场景思路可行。缺口：注入配置形态与通道（H1）、测试基建细节（L4）、§2 契约残留四小项（L1）、用户可触达边集未定义（M3） |
| 3 | 技术正确性 | 部分通过（1 high + 2 medium + 1 low） | 成立：spawn 参数数组不经 shell（无引号/空格注入面）、`detached:true` + `process.kill(-pid)` 是 Linux 进程组 kill 的正解、内存 `Map<ticketId, RunningRound>` 单进程调度与「无队列」一致、drizzle 增量 migration（`0000_harsh_power_pack` → `0001_*`）与启动 `migrate()` 链路可复用。缺口：MUST-2 通道优先级与 permission 形态（H1）、进程组 kill 无验证载体 + vitest 默认 5s 超时（M2）、BLOCKER 方向/顺序（M1） |
| 4 | 工程完备 | 部分通过（2 low） | fence 扩展方向正确（四包 tsc + test×3 + web build）、commit 纪律与「完成即 commit」可承袭 S1。缺口：既有 S1 用例回归面未列（L3）、定位基准/启动装配/文件集与命令细节（L5）、模板参数构造边界（L6） |
| 5 | 范围控制 | 通过 | 与 spec §2 做清单 10 项逐条对应，非目标重申完整（interactive / pending:agent / 池 / 文件集校验 / DREAM / 多仓 / 发布产物均未越界）；in-process 协议位与 `worker-pi` 未实现符合 Epic §12 |

## B1-B9 锚点核对

| # | impl 锚点 | 判定 |
|---|---|---|
| B1 | `server/dispatcher.test.ts` fake-done 全链（建 TASK→放行→spawn→IN_PROGRESS→报告 done→commits 落库→DONE + worktree 内 commit 实存）；§8「B1 真跑」真实 opencode 全链一次 | ✅（真跑留 Oracle 收尾，与 spec 口径一致） |
| B2 | 放行前置③ + 错误码 `WORKTREE_SETUP`；测试「worktree 目录只读→422 留 SPEC_READY 无 spawn」 | ✅ |
| B3a/b/c | fake-blocked → BLOCKED + BLOCKER（含 blockReason）→ 三裁决分支各一用例 | ⚠ 锚点在，但改派路径的事务顺序未固化（M1：顺序写错则恒 422） |
| B4 | fake-crash `process.exit(1)` → FAILED + `t{id}.r1` 双 JSONL + raw 首行执行元数据含注入摘要 | ✅ |
| B5 | 超时 → 杀进程树 → FAILED | ⚠ 机制递延给 Builder（`timeoutMin=0` 语义）+ 只断言 FAILED，未验证「进程树」（M2） |
| B6 | fake-noreport → round=2 → 仍缺 → L3 BLOCKER 留言含最后一轮 raw 路径 | ✅ |
| B7 | `profile.test.ts`：`git push`/`remote` 拒 + `sk-`/长随机串拒 + 合法 yaml 过 | ✅ |
| B8 | `worktree.test.ts`：allocate 幂等复用 / reclaim keepBranch 两分支 / running 单 `WORKTREE_ACTIVE` / commit 关联不受影响 | ✅ |
| B9 | 前半句：raw 首行含注入摘要（挂 B4）✅；后半句「单测断言注入内容含正确 deny 规则」无专属用例行，且 deny 规则集以「等」带过 | ⚠ 归入 H1 |

MUST 覆盖速核：MUST-1 ✅（前置③ + 运行期失败分流 + spawn cwd 锁 worktree）、MUST-3 ✅（模板 token 黑名单 + ATD 零 push 路径）、MUST-4 ✅（路径/分支仅 worktree 模块与回收 API 触达）、MUST-5 ✅（每轮双 JSONL、无清理路径）、MUST-6 ✅（Registry 凭据扫描 + profile 零凭据字段）、**MUST-2 ⚠（见问题 1）**。

## 发现的问题

### high

1. **MUST-2 注入载体：permission 形态不合法 + 通道优先级低于工作目录 project config**（维度 1/3；spec §6-MUST-2、B9）— 严重程度：high
   - 证据①（形态）：impl §0「临时配置文件 …（**permission.bash.deny 数组**含 `git*push*` 等）」。opencode 官方 permission 形态是「工具名 → 规则对象 map」：`"permission": { "bash": { "*": "ask", "git push *": "deny" } }`，且规则「最后命中者生效」——catch-all 必须写在具体规则**之前**。`bash.deny` 数组不是合法形态：按字面实现，轻则配置校验报错（B1 真跑会暴露），重则被静默忽略、deny 实际不生效（MUST-2 落空）——而 B9 前半句（raw 首行含注入摘要）与单测「内容含 `git*push*`」都仍会通过，审计上「看着有注入」。
   - 证据②（通道）：官方配置优先级 Remote < 全局 `~/.config/opencode/opencode.json` < **`OPENCODE_CONFIG`(3)** < 项目 `opencode.json`(4) < `.opencode`(5) < **`OPENCODE_CONFIG_CONTENT`(6)** < managed。spawn 的 `cwd=worktree`，而 worktree 是**目标仓检出**（opencode 启动时「先在当前目录找配置，再向上到最近 git 目录」）——目标仓自带 `opencode.json`、或 worker 自己在 worktree 里写一个，都会**覆盖**注入的 deny 规则。impl 只把 `OPENCODE_CONFIG_CONTENT` 当作「键无效」的兜底，未识别优先级风险；spec 把键名划为实测开放点，但「实测键是否生效」检不出「能否被工作目录配置覆盖」。
   - 影响：MUST-2 的「宿主侧强制注入，不信任 worker 自律」前提被削弱；最坏情形为静默失效（无报错、无痕）。
   - 建议（写进 §0/§4 即可收口）：① 主用 `OPENCODE_CONFIG_CONTENT`（内联 JSON，优先级高于项目配置），`OPENCODE_CONFIG` 作兼容附加或删除；② 按对象 map 给出真实配置样例（`{"$schema":…,"permission":{"bash":{"*":"ask","git push *":"deny","git remote *":"deny"}}}`），并把 deny 集从「等」改为**枚举清单**；③ 新增 perm 生成函数 + 专属单测（`server/execution.test.ts` 或 `permission.test.ts`）断言生成内容含枚举规则【B9 后半句】；④ B1 真跑补一步「worktree 预置放宽 permission 的 opencode.json 后 deny 仍生效」的实证（或在 impl 记录该优先级边界与适用条件）。

### medium

2. **BLOCKER 关联方向未固化 + resolve 事务顺序有反例**（维度 1/3；spec §3.6、Epic §3/§5）— 严重程度：medium
   - 证据：spec/Epic 只写「blockedBy 挂父单」，两种读法都通（父单 blockedBy BLOCKER / BLOCKER blockedBy 父单）；impl §2 仅给 `blocker: Ticket | null`，未定查询方向；§2 行文「留言 note 后按裁决转移父单（…BLOCKER 单自身转 DONE…）」的罗列顺序暗示**先转父单**。
   - 影响①（方向）：S1 `TicketService.transition` 的 `assertDependenciesDone` 只在 `to=DISPATCHED` 时检查 `ticketId` 一侧的依赖行（`apps/server/src/domain/ticket-service.ts:396-412`）。若误取「BLOCKER blockedBy 父单」，改派路径上父单依赖集为空——Epic §5「人关 BLOCKER → 父单 DISPATCHED」的护栏被架空（语义反向，且测试不可发现）。
   - 影响②（顺序）：若取正确方向（父单 blockedBy BLOCKER）却先转父单再关 BLOCKER，改派（BLOCKED→DISPATCHED）必被 `BLOCKED_BY_PENDING` 拦下——B3c 恒 422（与历史「先清后建」同类的顺序陷阱）。
   - 建议：impl 写死三句——(a) 依赖行方向 `(ticketId=父单, blockedByTicketId=BLOCKER 单)`；(b) resolve/reassign 同一事务内 **先** 关 BLOCKER（→DONE + note 留言）**再** 转移父单；(c) 副作用声明：父单详情 `dependencies` 会新增该 BLOCKER 行（DependencyPanel 是否区分渲染由 B 块定）。

3. **B5 超时：机制递延给 Builder + 未断言「杀进程树」+ 测试超时未配置**（维度 1/4；spec B5）— 严重程度：medium
   - 证据①：spec B5 为「`timeoutMin=1` 临时 profile + sleep 任务 → 杀进程树 → FAILED」；impl §7 写「timeoutMin 最小 1 分？测试用 profile timeoutMin=0 语义=立即超时——**Builder 定夺**」并注明「Builder 定夺后写入 impl 修订」——把一个验收项的机制留白（spec §9 的三个开放点**不含**此项）。
   - 证据②：§7 该行只断言 FAILED；而 impl §0 的核心决策恰是「`detached:true` + 超时杀**进程组** `process.kill(-pid)`」——`sleep` 类 fixture 只能证明「直接子进程被杀」，无法区分「杀进程组」与「只杀子进程」，spec 措辞「杀进程树」没有验证载体。
   - 证据③：vitest 默认 `testTimeout=5000ms`，而超时路径 SIGTERM→3s→SIGKILL 本身 ≥3s，B3b/B4/B6 又有多次真实 spawn + 真实 git 操作 → `apps/server/vitest.config.ts` 与两个新包需显式提升 testTimeout，并让 SIGTERM 宽限期可注入（测试用短宽限），否则有偶发红面。
   - 建议：① 超时语义写死（建议 profile schema 增 `timeoutMs`（测试/精确用），或明确 `timeoutMin=0`=立即超时并把单位换算写清）；② fixture 造**孙进程**（如 `sh -c 'node -e "setTimeout(()=>require(\"fs\").writeFileSync(\"marker\",\"x\"),1500)" & sleep 30'`）并断言 marker 不产生 + `process.kill(pid,0)` 抛 ESRCH，自证进程组 kill；③ vitest testTimeout 与宽限期配置入 impl §6/§7。

4. **用户可触达的转移边未收口，与新语义冲突（现有 UI 按钮会「砖化」工单）**（维度 1/3；spec §4 IN_PROGRESS 语义注记）— 严重程度：medium
   - 证据：S1 白名单仍含 `DISPATCHED→IN_PROGRESS`、`IN_PROGRESS→DONE`（`apps/server/src/domain/status.ts:20-21`），web `TransitionActions.tsx`（`NEXT_STATUSES`/`ACTION_LABEL`，:16-31）在 DISPATCHED 渲染「开始执行」、IN_PROGRESS 渲染「完成关单」；impl §1 只**扩**白名单、§5 只加放行弹层，未收口这两条人可触达的边（新增的 `IN_PROGRESS→BLOCKED/FAILED` 也会一并暴露给人）。
   - 影响：spec §4 明示「本 Story 起 IN_PROGRESS 进入点=spawn 发起」。手点「开始执行」会造出**无进程的 IN_PROGRESS**，而 S1 白名单下该态只能转 DONE → 工单只能靠手动「完成关单」收场，与内存 `Map` 状态背离；反向地，worker 运行中手点「完成关单」会让退出分流落 `DONE→DONE` 非法转移（静默失败 + 编排层与 DB 分叉）。
   - 建议：impl 定义「用户可触达边集」并两处同步——server 侧 `/transition` 对 IN_PROGRESS/DONE/FAILED/BLOCKED 目标一律拒（或按来源态收窄）；web 侧移除「开始执行/完成关单」，保留 BLOCKED→CANCELLED 人为取消与放行弹层；`TransitionActions.tsx` 显式进 B 块文件集。

### low

5. **§2 契约残留四小项**（维度 2）— 严重程度：low
   - ① `report` 未写「取哪一轮」（多轮场景应取最新轮；B3b 续跑后 round=2 的报告才是 DONE 展示源）；② `logs?round=` 缺省值（运行中前端轮询需知缺省=当前轮）；③ `workerName` 层级（`ticket` 内 vs 详情顶层）与 `workerId` 落库时点（transition 时写入）未写死——B 块手抄 `types.ts`，层级错配只在运行期表现为空白；④ `{dataDir}/logs|prompts|runtime` 产物路径未复述（spec §3.2/§4 有），`atd-report.json` zod schema 归属（worker-core 供复用 vs server）与 `blocked→blockReason` 必填 refine 未写。
   - 建议：§2 补「report=最新轮」「logs 缺省=当前轮」「字段层级示例 JSON」；§3/§4 补产物路径与 schema 归属。

6. **spec §4 的 pre-spawn 失败与重启恢复路径落地过薄、测试零锚点**（维度 1/4）— 严重程度：low
   - 证据：spec §4 明列「运行期 worktree 建失败 / spawn 发起失败 → **DISPATCHED→CANCELLED** + system 留言『派发失败：<原因>，可重新放行』」与「重启扫描：IN_PROGRESS→FAILED + 留言『服务重启中断』、DISPATCHED 停留 → CANCELLED」；impl 仅 §0「重启恢复按 spec §4」与 §3 一行 `recoverOnStartup()` 带过（§3 的 `onDispatched` 只引「步 1-5 + 判定表 §3.7」，而 pre-spawn 分支在 §4 末尾、不在判定表内），§7 无任何对应用例。
   - 建议：§3 补分支说明 + §7 加两例（`recoverOnStartup` 对 IN_PROGRESS/DISPATCHED 两态的分流断言；worktree 建失败/spawn 抛错 → CANCELLED + system 留言断言），同时定 `addComment` 的 `authorType`（system 用于派发失败/重启中断、agent 用于「BLOCKER 首条=blockReason 全文」——现有服务层固定 `user/我`，前端已支持三型渲染）。

7. **新前置校验的既有测试回归面未列**（维度 4）— 严重程度：low
   - 证据：`workerId` 前置使 S1 用例至少 6 处会红（`apps/server/test/api.test.ts:47/56/61/67/197/215`，以及 `state-machine.test.ts`、`ticket-service.test.ts` 的 service 级 DISPATCHED 转移）；其中 `api.test.ts:47` 期望 `BLOCKED_BY_PENDING`，与 spec §4 三件套编号（①worker_id ②blockedBy ③worktree）冲突——校验顺序需明确（建议按 spec 顺序，用例补 workerId）；另 `TicketService.transition` 签名如何透传并落库 `workerId` 未定，直接决定既有单测适配范围。
   - 建议：§7 增「既有用例适配：api/state-machine/ticket-service 需补 workerId 的调用点清单 + 校验顺序声明」；`state-machine.test.ts` 的终态无出边用例宜纳入 FAILED。

8. **测试基建细节未固化**（维度 2）— 严重程度：low
   - ① B3b（继续→round 2→DONE）需要**轮次感知 fixture**：报告文件每轮被清理，同一 fixture 必须首轮 blocked、次轮 done——判定依据需写明（建议以 worktree 内残留 marker 判定，因 worktree 跨轮复用）；② fixture 必须以**绝对路径**引用（spawn `cwd=worktree`，写成 `node test/fixtures/fake-done.mjs` 会指向临时仓而 ENOENT）；③ fake workers 目录如何注入 Registry 未写（`loadRegistry(dir)` 已参数化，测试用临时目录 + yaml 即可）；④ B4 宜顺带断言 `t{id}.r1.raw.jsonl` 与 `.events.jsonl` 两文件齐备【MUST-5】。

9. **定位基准与工程装配细节**（维度 3/4）— 严重程度：low
   - ① `config.yaml` 与 `workers/` 的定位基准未定（`pnpm -F @atd/server test` 与 `tsx src/index.ts` 的 cwd 不同；S1 已有 `import.meta.url` 定位 migration 的先例可循），spec「启动缺失则报错」「workers schema 校验失败启动报错」未复述；② `dataDir`（日志/worktree/prompt）与既有 dev 库 `apps/server/data/atd.db`（`.gitignore` 已含 `apps/server/data/`）的关系未写——避免误移库/误清库；③ 块 A 文件集漏 `.specpipe/fence.sh`（§8 明确由块 A 改写）；④ `drizzle-kit generate` 需 `--name s2a` 才得 `0001_s2a`（默认随机名如 `0000_harsh_power_pack`）。

10. **模板替换与参数构造边界**（维度 3）— 严重程度：low
    - ① 必须先按空白**拆分 token** 再在 token 内替换占位（若先替换后拆分，含空格的 prompt 会被拆成多个参数）；② 模板校验只在 yaml **加载期**做，勿对渲染后命令重复校验（临时 worktree 路径/dataDir 内 UUID 易触发凭据扫描误拒）；③ prompt 以单参数传入受 Linux `MAX_ARG_STRLEN`（128KB）限制，超长 spec 快照会 `E2BIG`——建议加尺寸守卫或记为 known limit（若改走「文件路径 + 读取指令」需同步改 spec §3.4 口径）。

## 结论

# REJECT

状态：IMPL_REVIEWING → IMPL_DRAFT

一句话理由：骨架与 B1-B9 主干锚点齐备，但 MUST-2 的注入形态（`permission.bash.deny` 数组非合法形态）与通道（`OPENCODE_CONFIG` 可被 worktree 内 project config 覆盖）需按官方文档改写，另需固化 BLOCKER 关联方向与 resolve 顺序（否则 B3c 恒 422）、B5 超时机制与「杀进程树」断言、以及用户手动转移边集的收口——建议按上述 1 high + 3 medium（+6 low 顺手对齐）修订后过审。
