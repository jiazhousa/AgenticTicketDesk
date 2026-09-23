# Story Impl：S2a Worker 层 + 解单闭环

- **topic**：atd-s2a-worker-loop
- **上游 spec**：`../atd-s2a-worker-loop/spec.md`（v4 已放行，验收 B1-B9 为唯一来源）
- **状态**：S-S6 修订 v3（r2-N1：通道二分按 TASK/STORY 分流；N2：transition 适配清单+校验顺序；N3-N7），待三审
- **日期**：2026-09-23
- **S1 基线**：main 已含核心域；包名 `@atd/server` / `@atd/web`；**S1 既有 46 用例零破坏是块 A 验收前提**

---

## 0. 总体技术决策

| 项 | 决策 |
|---|---|
| 新包 | `packages/worker-core`（`@atd/worker-core`）/ `packages/worker-opencode`（`@atd/worker-opencode`）；server 依赖两者 |
| spawn | `spawn(cmd, args[], { cwd: worktree, env, detached: true })` 参数数组；**模板先按空白拆 token 再整体替换变量**（值含空格不二次拆分）；超时杀进程组 `process.kill(-pid)` SIGTERM→3s→SIGKILL |
| 执行模型 | server 单进程内存调度 `Map<ticketId, RunningRound>`；无队列（S3 池化）；重启恢复按 spec §4 |
| **opencode 权限注入（r1-H1 修正）** | 配置内容为**对象形态**：`{"permission":{"bash":{"*":"allow","git push":"deny","git push *":"deny","git remote *":"deny","gh *pr*create*":"deny"}}}`（catch-all 在前、last-match-wins）。注入通道：**主用 `OPENCODE_CONFIG_CONTENT`（内联 JSON，优先级最高不被 project config 覆盖）**；`OPENCODE_CONFIG` 文件路径仅作 fallback（Builder 实测两键行为，结论记 impl 修订）。注入摘要（键名+deny 规则集）写 raw 首行 |
| 超时可测性（r1-M2） | profile `timeoutMin` 正常语义；dispatcher 构造参数 `timeoutOverrideMs`（仅测试注入）。B5：fake-sleep + override 300ms |
| 测试策略 | **fake profile 为主**（node fixture 脚本全场景，不依赖 opencode）；真跑留 Oracle 收尾（B1 实证） |
| git 操作 | `execFileSync('git', [...])` 直调 |
| config 定位 | 项目根 `config.yaml`（以 **repo root** 为基准解析）；**dataDir 只管 S2a 产物**（worktrees/logs/prompts/runtime 四子目录），S1 的 DB 留 `apps/server/data/`（语义不变，避免迁移）；profile schema 唯一出处=`@atd/worker-core/profile.ts` |
| 注入实证分工 | `OPENCODE_CONFIG_CONTENT`/`OPENCODE_CONFIG` 双通道代码由 Builder 落实（fallback 链）；**真机实证归 Oracle 收尾 B1 真跑**（记录生效键名进 impl 修订） |

## 1. 数据库与状态机增量（migration `0001_s2a`）

```
tickets: + pending_label TEXT NULL（'l3'） + round INTEGER NOT NULL DEFAULT 0
ticket_commits: id / ticket_id / round / sha / created_at（UNIQUE(ticket_id, round, sha)）
ticket_reports: id / ticket_id / round / status('done'|'blocked') / summary / block_reason / created_at
```

状态机扩展（`status.ts`）：
- 新边（spec §3.5 全集）：IN_PROGRESS→BLOCKED(pending:l3)、IN_PROGRESS→FAILED、BLOCKED→{IN_PROGRESS, DISPATCHED, FAILED, CANCELLED}；转出 BLOCKED 清 pending_label
- **转移通道二分 + 按 type 分流（r2-N1）**：`transition(ticketId, to, { actor: 'user'|'system', ... })`
  - **STORY（纯编排，无执行）**：S1 人工边全保留（user 可达全集不变）——DISPATCHED→IN_PROGRESS / IN_PROGRESS→DONE 对 STORY 仍是 user 边
  - **TASK（执行单）**：DISPATCHED→IN_PROGRESS 与 IN_PROGRESS→DONE 划为 system 边（dispatcher spawn 后进 / 结算进）；user 边白名单=SPEC_READY→DISPATCHED（需 workerId）/ SPEC_READY→CANCELLED / DISPATCHED→CANCELLED / BLOCKED→CANCELLED
  - user 请求 system 边 → 422 `MANUAL_FORBIDDEN`。**判定优先级（r3-M1）**：先查完整转移表（含 system 边）——不在表内 → `INVALID_TRANSITION`；在表内但 actor=user 不可达（type 分流）→ `MANUAL_FORBIDDEN`。S1 非法边用例（如 DRAFT→DONE）期望码不变
  - 测试环境 dispatcher 自动触发可控：构造注入 `autoDispatch`（缺省 true；api.test/state-machine.test 等 helper 关闭，仅 dispatcher.test 显式开启）——放行只走校验不触发 spawn，时序确定
- **放行前置校验顺序写死（r2-N2，保持 S1 期望码稳定）**：① blockedBy 全 DONE（既有 `BLOCKED_BY_PENDING`，最优先）② TASK 且 to=DISPATCHED 时 workerId 必填（`WORKER_REQUIRED`）且∈Registry（`WORKER_UNKNOWN`）③ worktree 可建（`WORKTREE_SETUP`）。workerId 落库时点=该转移事务内（写 worker_id 列）

## 2. API 契约扩展（块间唯一契约面；types.ts 出处）

| 端点 | 说明 |
|---|---|
| GET /api/workers | `[{id, name, protocol, capabilities}]` |
| POST /api/tickets/:id/transition | body `{ to, note?, workerId? }`；user 白名单边 + TASK 放行 workerId 必填（`WORKER_REQUIRED`）且在 Registry（`WORKER_UNKNOWN`）；system 边 → `MANUAL_FORBIDDEN` |
| GET /api/tickets/:id | `{ ticket（含 round/pendingLabel/workerId）, workerName: string\|null, execution: {startedAt}\|null（当前轮 spawn 时间）, children, dependencies, comments, transitions, hasCancelledChildren, commits: [{round, sha}], report: {round, status, summary, blockReason}\|null, blocker: Ticket\|null }`（report=最大 round；blocker=未关 BLOCKER） |
| GET /api/tickets/:id/logs?round=&tail=50 | `{ round, events: UnifiedEvent[] }`（tail 缺省 50、上限 500；round 缺省=当前轮） |
| DELETE /api/tickets/:id/worktree?keepBranch=true | 回收；执行中/非终态 → 422 `WORKTREE_ACTIVE` |
| POST /api/tickets/:blockerId/resolve | body `{ resolution: 'continue'\|'reassign'\|'abort', note?, reassignWorkerId? }`。**执行顺序（r1-M1 固化）**：① note 留言落 BLOCKER ② BLOCKER→DONE（system 通道）③ 按裁决转父单（**此时 BLOCKER 已 DONE，父单 blockedBy 依赖门天然放行**）：continue→父 BLOCKED→IN_PROGRESS + dispatcher 异步原 worktree 重 spawn；reassign→校验 reassignWorkerId∈Registry→父 BLOCKED→DISPATCHED（绑定新 worker）+ dispatcher spawn；abort→父 BLOCKED→FAILED。BLOCKER 不存在/已关/父单非 BLOCKED → 422 `RESOLUTION_INVALID` |

**BLOCKER 关联方向（r1-M1）**：复用 S1 依赖表，行=（父单.id, blocked_by=BLOCKER.id）——语义「父单被 BLOCKER 阻塞」，与 blockedBy 门自洽。

错误码新增：`WORKER_REQUIRED` / `WORKER_UNKNOWN` / `WORKTREE_ACTIVE` / `WORKTREE_SETUP` / `MANUAL_FORBIDDEN` / `RESOLUTION_INVALID`（均 422）。

## 3. server 新模块

```
src/config.ts        config.yaml 加载（zod：repoPath/dataDir/defaultTimeoutMin/retryOnReportMiss；dataDir 默认 ~/.local/share/atd）
src/worktree.ts      allocate(ticketId)（已存在复用）/baseline()/reclaim(keepBranch)/pathFor()
                    路径 {dataDir}/worktrees/{repoName}-t{id}；分支 atd/t{id}；基线=repo 默认分支 HEAD
src/dispatcher.ts    onDispatched(ticket)（spec §4 步 1-5+判定表分流；timeoutOverrideMs 注入位）
                    /resolveBlocker(§2 顺序) /recoverOnStartup()（IN_PROGRESS→FAILED+留言；DISPATCHED→CANCELLED+留言）
src/execution.ts     渲染模板（拆 token→替换）→spawn→stdout 逐行→双 JSONL（raw 首行元数据：command/env 注入摘要/baseline/round/timeout）→超时进程组 kill→exit
src/perm-config.ts   MUST-2 配置生成（§0 对象形态规则集，导出常量+buildPermJson()——单测直接断言规则内容）
src/report.ts        atd-report.json 读取+zod；commits=git log 基线 diff 落库；报告落库
src/routes/*         §2 端点；prompt 超长（>128KB）422
test/                §7
```

## 4. packages 设计

**@atd/worker-core**：
- `events.ts`：UnifiedEvent（text-start/delta/end、tool-call、tool-result(errored?)、finish、turn-start/end）
- `profile.ts`：WorkerProfile zod + validateProfile（模板推送 token：`git push`/`remote`/` push `；凭据扫描：`sk-`/`glpat-`/`ghp_`/`xoxb-` 前缀或 32+ 连续 [A-Za-z0-9_-]）
- `registry.ts`：loadRegistry(dir)（id 冲突报错）+ WorkerRuntime 接口位（S2a 不实现）

**@atd/worker-opencode**：
- `map-events.ts`：opencode 事件→UnifiedEvent（step_start→turn-start；text→text-start+delta+end；tool_use→tool-call+tool-result(errored=status error)；step_finish→turn-end；exit 0→finish）
- `parse-line.ts`：单行 JSONL（非 JSON 行跳过计数）

预置 `workers/opencode.yaml`：`command: opencode run --standalone --format json {{prompt}}`（**B1 实证修订**：本机版本 run 无 `--dir` flag；`--standalone` 私有 server 防共享会话串扰；`{{prompt}}` 注入 prompt 全文单参数——文件路径形态会被 opencode 当 usage 错误；工作目录由 spawn cwd+prompt 头部强约束双重保证——opencode 会从 worktree 的 .git gitfile 解析主仓当项目根导致 shell workdir 错位，实证 commit 曾落主仓分支，prompt 约束根治）。timeoutMin 30。
**`config.yaml`**（随仓，repo 根）。

## 5. 前端增量（apps/web，契约=§2）

```
api/tickets.ts +：getWorkers/resolveBlocker/reclaimWorktree/getLogs；types 同步
components/DispatchForm.tsx    放行弹层（SPEC_READY 且 TASK）：选 worker→transition（workerId 同 body）
components/WorkerCard.tsx      profile/轮次/启动时间/事件流尾部（tail=30，执行中 5s 轮询；tool 名+文本）
components/ReportCard.tsx      DONE：summary+commits
components/BlockerCard.tsx     BLOCKED 卡：BLOCKER 入口+裁决弹层（continue/reassign 选 worker/abort+note）→resolveBlocker
StatusTag +BLOCKED/FAILED；TransitionActions 收口为 user 白名单边（MANUAL_FORBIDDEN 错误 toast 原样透出）
TicketDetailPage 插 Worker/Report/Blocker 卡；BLOCKER 单渲染 resolve 入口；列表状态筛 +BLOCKED/FAILED
```

## 6. 任务切分（两 Builder 并行，文件集不相交）

| 块 | 文件集 | 验证命令 |
|---|---|---|
| **A worker 层+server**（分支 `dev/feat/atd-s2a-core`） | `packages/worker-core/**`、`packages/worker-opencode/**`、`workers/opencode.yaml`、`config.yaml`、根 `pnpm-workspace.yaml`/`package.json`/`tsconfig.base.json`（packages 接入所需）、`.specpipe/fence.sh`（扩四包）、`apps/server/**` | `pnpm install && pnpm -F @atd/worker-core test && pnpm -F @atd/worker-opencode test && pnpm -F @atd/server test`（S1 46 用例零破坏） |

**S1 适配清单（r2-N2，块 A 内完成，逐文件）**：
- `transition()` 签名加 actor 参数（缺省 'user'）——S1 全部调用点零改动（缺省兼容）
- `api.test.ts`：TASK 全链用例的 SPEC_READY→DISPATCHED 调用补 `workerId`（helper 预载临时 workers/ fixture 目录注册 fake profile）；STORY 全链用例零改动（人工边保留）。**TASK 的 DISPATCHED→IN_PROGRESS / IN_PROGRESS→DONE HTTP 手推（:57-58/:62-63）：期望码改断言 `MANUAL_FORBIDDEN`（收口回归锚点），后续态由 system helper 完成**。测试 app 构造 `autoDispatch=false`
- `ticket-service.test.ts` / `state-machine.test.ts`：walkTo helper 加 system 通道参数——TASK 的 DISPATCHED→IN_PROGRESS/IN_PROGRESS→DONE 断言改走 system（语义即「dispatcher 进/结算进」）；STORY 用例不变；**TASK 放行步补 workerId（helper 预载 fake profile）**
- 校验顺序按 §1 写死后跑全量——`api.test.ts` 期望码不变（blockedBy 仍最优先）
| **B web UI 增量**（分支 `dev/feat/atd-s2a-web`） | `apps/web/src/**` 增量 + `README.md` | 文件级交付（契约对照+TS 自查）；Oracle 收尾统一 build |

- fixture 脚本（fake-done/blocked/crash/sleep/noreport.mjs）放 `apps/server/test/fixtures/`，临时 profile yaml 在测试内生成（fixture 绝对路径写入），不动 `workers/` 预置目录
- 冲突面：无共享文件；lockfile 由 A 生成、Oracle 收尾重生成

## 7. 测试清单（vitest；锚定 B1-B9 + r1 补充锚点）

| 文件 | 用例与锚点 |
|---|---|
| `worker-core/profile.test.ts` | 推送 token 拒/凭据拒/合法过【B7】 |
| `worker-opencode/map-events.test.ts` | 四类映射含 tool error；非法行跳过 |
| `server/perm-config.test.ts` | buildPermJson 输出含 bash 对象与 `git push` deny 条目（**B9 专属断言**，规则集逐条） |
| `server/state-machine-s2a.test.ts` | 新边 system 通道合法各一例；user 请求 system 边→MANUAL_FORBIDDEN；TASK 放行无 workerId→WORKER_REQUIRED；转出 BLOCKED 清 pendingLabel |
| `server/dispatcher.test.ts`（真实 spawn+临时 git 仓+fixture profile；文件级 testTimeout=30s） | **B1 全链**（fake-done→DONE+commits 落库+worktree commit 实存）；**B3a/b/c**（fake-blocked 支持环境变量参数化 `BLOCK_MODE`：首轮 blocked/次轮 done——continue 裁决后 round=2 写 done 报告可 DONE；BLOCKER(blockedBy 方向断言)+blockReason→三裁决：continue round=2 原 worktree→DONE / reassign 换 profile 分支延续（git log 保留 r1 commits）/ abort→FAILED）；**B4**（fake-crash→FAILED+双 JSONL+raw 首行元数据含注入摘要）；**B5**（fake-sleep spawn 孙进程写 pid 文件+timeoutOverrideMs=300→FAILED+**进程组全灭断言**（child pid 与孙 pid 均 ESRCH））；**B6**（fake-noreport→round=2→L3 BLOCKER 留言含 raw 路径，留言 authorType=system）；**B2**（dataDir 只读→放行 422 WORKTREE_SETUP 留 SPEC_READY）；**r1-L2 补**：pre-spawn 运行期失败→CANCELLED+留言；recoverOnStartup（造 DISPATCHED/IN_PROGRESS 单→CANCELLED/FAILED+留言） |
| `server/worktree.test.ts` | allocate 复用/reclaim 两分支【B8】/执行中→WORKTREE_ACTIVE |
| `server/api-s2a.test.ts` | §2 端点全（详情聚合字段/日志 tail/resolve 校验链：非 BLOCKER/已关/父非 BLOCKED→RESOLUTION_INVALID，reassign 缺 workerId→422/prompt 超长→422）；**S1 回归**：既有 api.test 全链在 helper 预载 fixture 下全绿 |

## 8. 工程与收尾（Oracle 执行）

- worktree ×2：`AgenticTicketDesk-s2a`（块 A，`--name` 即目录名）/`AgenticTicketDesk-s2b`（块 B），自 main 拉
- 收尾：merge→全量 install 重生成 lockfile→fence（四包）→**B1 真跑**（真实 opencode profile+临时 git 仓：写文件+commit 全链）→UI 冒烟（放行选 worker/事件流/报告卡/裁决）→质量门
- 分支不合 main（用户验收后）

## 9. 非目标重申

无 interactive/聊天框、无 pending:agent、无并行池、无文件集校验、无 DREAM、无多仓、无发布产物。
