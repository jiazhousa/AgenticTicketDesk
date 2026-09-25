# 质量门审查报告: atd-s3-parallel-retry (Revision 1)

> 终检判定：**PASS（91/100）**。七项清单全部通过；1 处 medium（排队单取消不触发队列重校验，属 spec 规则 5 触发面枚举缺口，实现忠实于 spec 字面）+ 2 处 low（merge 主题英文 / 验收 2 后半放行腿无用例），均不阻塞用户验收；另 9 项非扣分观察。
>
> 本轮唯一 medium 为**规格层缺口**（建议 spec 勘误 + 一行修复），非实现偏离；用户验收 1-10 条全部有真实落点。

- 类型：Story 质量门全面审查（S-S10 终检 · 首轮 / r1）
- 对象：worktree `/home/starlex/project/ATD-s3-server`，集成分支 `dev/feat/atd-s3-parallel-retry` @ `e881861`（merge = `9e091e7` 块 1 server + `d5659e4` 块 2 web，两特性 commit 父均 `f7ec194`）
- 基线：`f7ec194`；`git diff f7ec194..e881861` = **30 文件 +3045/-129**（块 1 = 22 文件（server 21 + `config.yaml`）、块 2 = 8 文件；`git diff 9e091e7..e881861` 恰为 web 8 文件，`git diff d5659e4..e881861` 恰为块 1 22 文件 —— 双向核验零重叠、零丢失）
- 事实源：spec v3.1 / impl v4.1（主仓与 worktree 两副本 md5 逐字节一致：spec `e8ee3b22…`、impl `f3c52839…`，单一事实源成立）
- 状态校验：实测 `.stage`（session 工作目录 = 主仓 `AgenticTicketDesk/.specpipe/plans/atd-s3-parallel-retry/.stage`）= `QUALITY_GATE`，与质量门「审查前状态」一致 → 允许落定（worktree 内 `.specpipe` 副本 `.stage` 滞后为 `IMPL_APPROVED`，系分支快照，非权威）
- 日期：2026-09-25

## 总体评价

**通过**。S3 三条主线（`plannedFiles` 双层防线 + 排队治理 + RETRY_WAIT 自愈引擎）在合并态逐面核查落实：双集合口径（闸门=DISPATCHED+IN_PROGRESS / 占用集=+排队+BLOCKED）与 impl §技术方案 3 逐字一致；八处 dispatcher 直调 + 两条 user 取消边回调（setter 注入、fire-and-forget）+ 启动扫描共用一个 `releaseAndRecheck`，与 impl §技术方案 5 清单一一对应；先判后等退避 60/120/240（maxRetries=3 三档全可达）与当次升级 l3 由注入时钟用例逐值锁定；实测防线落 `ticket_files` + 双方 system 预警；migration 0004 + D4 快照链修复经结构比对判据成立（0003 = 0002+`block_reason`，0004 = 0003+5 列+1 表，prevId 链完整，且每个测试库都跑全链 migrate —— 175 用例绿即迁移可应用性实证）；web 侧契约手抄与 UI 三区分区（l3 裁决 / agent 只读 / 排队徽标）齐备。Checker 独立复跑 server 175/175 + web build + 三包 tsc 全绿，复跑后 `git status` 干净（未改一文件）。

## 质量评分

**91 / 100**

| 严重度 | 条数 | 单扣 | 小计 |
|---|---|---|---|
| critical | 0 | -25 | 0 |
| high | 0 | -12 | 0 |
| medium | 1 | -5 | -5 |
| low | 2 | -2 | -4 |

扣分项：1（排队单取消不触发队列重校验 → FILE_CONFLICT 排队单可滞留）、2（merge `e881861` 默认英文主题）、3（验收 2 后半放行腿无用例），见「发现的问题」。

## fence 结果

Checker 在冻结树上独立复跑（同一 worktree、未改一文件；复跑后 `git status` 复核仍干净，`apps/web/dist/` 为 gitignore 内构建产物）：

- `pnpm -F @atd/worker-core test`：7 用例（1 文件），7 通过，0 失败，0 跳过（0.48s）
- `pnpm -F @atd/worker-opencode test`：9 用例（1 文件），9 通过，0 失败，0 跳过（0.38s）
- `pnpm -F @atd/server test`：**175 用例（13 文件）**，175 通过，0 失败，0 跳过（6.84s）—— 逐文件：perm-config 3 / file-set 8 / workspaces 10 / api-s3 5 / workspace-contract 12 / api-s2a 16 / api 11 / state-machine-s2a 18 / state-machine 20 / ticket-service 35 / worktree 9 / workspace-crossrepo 3 / dispatcher 25
- `pnpm -F @atd/server typecheck`（`tsc --noEmit`）：静默通过
- `pnpm -F @atd/web build`（`tsc --noEmit && vite build`）：成功（3063 modules；`dist/assets/index-DZS3sHHd.js` 1.16MB / gzip 366KB，2.88s；chunk 体积告警为存量现象）
- E2E 测试：无（本项目无 E2E 基建，与 S1/S2a/S2w1 同口径；真实链路以 dispatcher 真跑用例 + 双 fake worker 并行用例为证）
- 合计：**191 用例，191 通过，0 失败，0 跳过**（server 131 → 175 = 新增 44，与调度者 fence 摘要一致；本报告复现值与摘要逐项吻合）

> 说明：调度者侧全量 `bash .specpipe/fence.sh` 报 ALL GREEN（含 `pnpm install --frozen-lockfile`），与本节独立复跑结论一致；E2E 分段无用例。

## 七项清单逐项结论

### 1. 实现与 impl 一致性 —— 通过

impl §改动点块 1 逐行落码核对（含 API 契约冻结节）：

| impl 条目 | 实测落点 | 判定 |
|---|---|---|
| schema +5 列 + `ticket_files`（UNIQUE(ticket_id,round,path)） | `schema.ts:33-41/119-132` | ✓ |
| migration 0004 + D4 快照链修复 | `0004_s3_parallel.sql`（5 ALTER + 1 表 + 1 唯一索引）/ `meta/0003_snapshot.json`（新）/ `0004_snapshot.json`（新）/ `_journal.json` idx 4 | ✓ 结构判据成立（见「总体评价」） |
| config +3 键 / `retryOnReportMiss` 废弃读取位 | `config.ts:25-31/64-68`；`config.yaml` 删旧键加三键 | ✓ 全仓仅 warn 位消费，零行为消费方 |
| `FILE_SET_CONFLICT` 入封闭 union（422） | `errors.ts:22/44` | ✓ |
| `file-set.ts` 精确+`dir/` 前缀、双向复用 | `file-set.ts:8-36`，被 `ticket-service.ts:7/717`（声明vs声明）与 `dispatcher.ts:10/400/621`（实测vs声明、唤醒复校验）三方消费 | ✓ 单实现双向复用 |
| ①`onInflightReleased` setter | `ticket-service.ts:168`；`app.ts:122` 箭头包裹 | ✓ |
| ②submitSpec 扩 plannedFiles（空数组→NULL、读侧 JSON.parse 还原） | `ticket-service.ts:425-460`、`parsePlannedFiles:142-150`；`routes/tickets.ts:57-61/129` | ✓ 冻结与 specContent 同入口同时机 |
| ③仅 SPEC_READY→DISPATCHED 边：四件套→闸门/文件集→落队 | `ticket-service.ts:507-549`（四件套 user 通道）/`528-549`（治理，写死后置） | ✓ 作用域正确（reopen/resolve 直执行） |
| ④pendingLabel 参数化 | `ticket-service.ts:556-558`（缺省 `'l3'`，`'agent'` 显式生效） | ✓ |
| ⑤两条 user 取消边回调 + 任何离开 SPEC_READY 清 queued | `583-594`（枚举仅 DISPATCHED/BLOCKED→CANCELLED）/`560` | ✓ |
| ⑥双集合查询函数 | `gateOccupancy:627-642`、`fileSetHolders:648-688` | ✓ 与 spec 规则 2 一致 |
| ⑦list/detail 透出五字段 | `toTicket:131-139`（`...row` + `plannedFiles`/`queuedReason` 映射） | ✓ 列表与详情同一映射 |
| dispatcher：`releaseAndRecheck` + **八处直调** | 直调落点 = settle DONE:302 / 超时 FAILED:259 / 崩溃 FAILED:272 / 卡点 BLOCKED:328 / RETRY_WAIT 入口:370 / preSpawnFail-CANCELLED:431 / preSpawnFail-FAILED:439 / abort→FAILED:474（grep 全量枚举，无遗漏无多余） | ✓ 与 impl 清单一一对应 |
| dispatcher：移除立即 bumpRound+respawn 循环 | `startRound/runOnce` 已无 while 续跑结构，报告缺失分支改单次 RETRY_WAIT 返回 | ✓ |
| dispatcher：5s tick（seam 注入）+ 每单 try/catch | `startTick/stopTick:65-78`、`onTick:642-663`、`recoverRetryWait:666-686`（try/catch 在 `onTick:657-661`） | ✓ |
| dispatcher：settle DONE 实测文件 + 交叉预警 | `recordTouchedFilesAndWarn:378-414`（`report.ts:55-60` `extractTouchedFiles`，与 commit 提取同源同通道） | ✓ 仅 DONE 落库+比对 |
| dispatcher：recoverOnStartup 扩展 | `694-746`（执行态收敛 + 到期 RETRY_WAIT 立即恢复 + `releaseAndRecheck()` 全量） | ✓ |
| app.ts 装配（setter/tick/onClose 清理） | `app.ts:120-137`（`startTick()` 随 buildServer；`addHook('onClose')` 清 interval） | ✓ |
| report.ts `extractTouchedFiles` | `report.ts:51-60`（`git diff --name-only baseline..HEAD`） | ✓ |
| routes/types.ts 五字段（无独立 Body 类型） | `types.ts:12-18` 注释 + 复用域类型 | ✓ |
| helpers 三键 + tick/now 透传 + 双并行 fake worker | `helpers.ts:67-112/150-211`；`fixtures/fake-done-arg.mjs` | ✓ |
| 块 2 八文件 | types/tickets/QueuedTag/SpecCard/TransitionActions/Workbench/TicketList/TicketDetail 逐文件核对（见 §2/§6） | ✓ |

server↔web 契约逐字段对齐：`web/src/api/types.ts` 的 `queuedReason: 'GATE_QUEUED'|'FILE_CONFLICT'|null`、`queuedAt/retryCount/retryAt/plannedFiles` 与 `routes/types.ts`→`ticket-service.ts` 域类型同形；`submitSpec` 入参 `{specContent, plannedFiles?}` 两端一致（web 侧空数组省字段，server 侧空数组→NULL，语义等价）。

### 2. 代码质量（OCR 流水线）—— 通过

规则注入：按变更文件后缀加载 `ts_js_tsx_jsx.md`（30 文件中 27 个 `.ts/.tsx`）+ `yaml.md`（`config.yaml`）+ `json.md`（`_journal.json`、两 snapshot）；无 `default.md` 兜底触发。

逐文件审查（行级锚定 + 事实校验，diff 可证伪者剔除）：

- `file-set.ts`：匹配语义单一实现（`entryMatches` 相等或尾斜杠前缀），`intersects`/`intersectingPaths` 双入口无逻辑分叉；空集/未声明由调用方跳过（模块边界自洽）。无死代码。
- `ticket-service.ts`：事务内只写同步代码（铁则 1）保持；排队路径无 transitions 行（`enqueue` 不写转移，`602-620`）；`fileSetHolders` 的 SPEC_READY 分支用 `isNotNull(queuedReason)` 二次查询而非一次 inArray 混合，等价且可读；`findFileConflict` 与 `fileSetHolders` 口径一致（均排除未排队 SPEC_READY、未声明跳过）。
- `dispatcher.ts`：`releaseAndRecheck` 三类挂载共用，异常隔离到位（`599-605` 每单 try/catch、`656-662` tick 每单 try/catch、`702-722` 重启每单 try/catch）；`tryReleaseQueued` 在 `transition` 后再验 `status==='DISPATCHED'` 才 spawn（防权威复校验后重排队时误 spawn，`626-633`）；`onTicketSettled` 同等防护（`559-566`）。**未发现线程/并发竞态**：单进程 + better-sqlite3 同步事务 + `running` Map 单轮登记，`settle` 前置 `status!=='IN_PROGRESS'` 防御（`246-249`）。
- 性能：闸门/占用集查询为同仓小结果集全表过滤 + 索引缺位（`tickets.status/repo_ref/workspace_id` 无索引），单用户自用规模可接受；排队全量扫描 O(排队单数)。无 N+1 放大（实测预警仅对同仓 holders 线性遍历）。
- 安全：无新增外部输入直入 SQL（Drizzle 参数化）；`plannedFiles` 仅文本路径，无路径拼接写文件动作（`extractTouchedFiles` 走 `execFileSync` 参数数组，不经 shell）。
- 全仓扫描（新增行）：无 `TODO/FIXME/XXX`、无 `as any`/`@ts-ignore`/`eslint-disable`、无 `console.log` 残留（两处 `console.error` 均为异常路径留痕，符合既有风格）；注释全中文、终态化表述（无「旧口径/替代/rev」类历史演进字样）。
- 前端：`useNow(enabled)` 仅在存在 agent 态阻塞单时启 1s 心跳（`WorkbenchPage:120`、`TicketDetailPage:65` 均在早退分支前调用，hook 顺序稳定）；`QueuedTag` 非排队态渲染 null、`showTime` 紧凑态复用；`TransitionActions` 排队判定与契约冻结节逐字一致（`status==='SPEC_READY' && queuedReason`）。

### 3. commit 信息 —— 通过（1 处 low）

区间实测 3 个 commit：`9e091e7`（块 1 server，父 `f7ec194`）、`d5659e4`（块 2 web，父 `f7ec194`）、`e881861`（merge）。两特性 commit 主题为简洁中文，正文按交付面分条（治理机制/唤醒挂载/自愈引擎/实测防线/声明/migration/配置/seam/测试），符合本仓既有风格（对照 S2a/S2w1 各 commit）。merge `e881861` 为 git 默认英文主题，见问题 2。

### 4. 整体编译 —— 通过

`pnpm -F @atd/server typecheck`（`tsc --noEmit`）静默通过；web 侧 `tsc --noEmit` 随 build 通过；worker-core/worker-opencode 随 fence 通过。无类型逃逸（无 `as any`/`@ts-ignore`）。

### 5. 受影响模块测试（fence）—— 通过

见「fence 结果」节：Checker 独立复跑四命令全绿（191/191），`git status` 复跑前后均干净。

### 6. 测试覆盖与回归 —— 通过（1 处 low）

**新增 44 用例 ↔ 验收映射与断言强度抽查**（逐文件核对 + 通读新增用例；断言均为状态/幂等/时序真值，非冒烟式）：

| 新增用例（文件 · 摘要） | 断言强度要点 | 覆盖 |
|---|---|---|
| file-set ×8（精确/前缀/嵌套/根/双向/空集/details 形态） | 正反例成对 + `intersectingPaths` 去重保序值等 | 规则 1 |
| api-s3 ×5（422 details 结构 / system 排队 / 闸门满 200 排队响应 / 五字段透出 / plannedFiles 校验 400） | details 全串含双方单号+相交文件；排队后可取消且字段清空；列表+详情双面 | 验收 2/3/8/9 |
| ticket-service ×20（声明冻结与往返 / 四件套先行两例 / 两通道分流 / 重排队保 queuedAt / 文件集五例 / pendingLabel+记账 / 取消边回调三例 / 生命周期+双集合+reopen-reassign） | 「无 transitions 行」用行数前后比对；「四件套先行」用错误码+字段零污染双断言；双集合用 holders id 集合等比 | 规则 1-4、8-9 |
| dispatcher ×11（FIFO 恢复 / 饥饿免疫四路径 / user 取消边 / abort 直调 / 退避三档+升级 / tick 顺延 / 重启两类 / 实测预警 / 双并行真跑） | FIFO 用「queuedAt 有序 + 唤醒转移行 id 先后」双证据；退避用注入时钟断言 `retryAt` 精确值（T0+60/180/420s）；升级断言 transitions 无 BLOCKED→BLOCKED 同态行且 4 行 from=IN_PROGRESS；并行隔离断言 worktree/分支名/HEAD/落库 commit/日志/产物六面 | 验收 1/3/4/5/6/7 |
| B6 重写（`dispatcher.test.ts:285-341`） | 第 1-3 次缺失逐档校验 `retryCount`/`round`/`retryAt` 精确值，「第 4 次进入即升级」`retryCount=4>maxRetries=3` → `pendingLabel='l3'` + `retryAt=null` + 摘要含失败轮次区间 `1..4` 与末轮 raw 路径 | 验收 5（impl 逐条列明改动） |

**回归口径（验收 9）**：`ticket-service.test.ts` 为**纯新增**（352 insertions / 0 deletions），存量用例零改动；`dispatcher.test.ts` 改动仅 B6 重写 + 新增 describe（存量 14 例断言未变）；`helpers.ts` 仅删已废弃的 `retryOnReportMiss` 注入项（消费方仅 dispatcher 测试）并扩三键/时序透传。13 文件 175 用例全绿（含 S2a/S2w1 全链：状态机/API/编排/dispatcher 真跑/跨仓），存量行为零回归成立。

**未覆盖项（已知/可接受）**：① 验收 2 后半（system 排队 FILE_CONFLICT 单在占位单落定后自动放行执行的端到端腿）无用例——见问题 3；② 前端无自动测试基建（项目现状，以 build + 代码核读 + Oracle 冒烟为证）；③ `enqueue` 在 workerId 为 null 时的滞留面（API 不可达，见 O4）。

### 7. 文档归档与 AGENTS.md —— 通过（含交付后建议）

- spec v3.1 / impl v4.1 在 worktree `.specpipe/plans/atd-s3-parallel-retry/` 与主仓同路径齐备且逐字节一致；审查链齐备（spec r1/r2 + impl r1/r2/r3/r4 报告，主仓与分支双向可见）。
- **AGENTS.md 未随 S3 更新**（本 Story 未改）：现文缺 S3 语义（排队/闸门/自愈重试/`plannedFiles`/`ticket_files`/`maxConcurrentPerRepo` 等）。按 S2w1 终检先例（AGENTS.md 属交付后动作、不扣分），本项**不扣分**，建议清单见下节；归属判定：**交付后动作**（由调度者决定在本门落定后或合入 main 的同一动作内同步）。

## 验收标准 1-10 逐条核验（spec v3.1）

| # | 验收 | 代码落点 | 用例 | 判定 |
|---|---|---|---|---|
| 1 | 并行隔离真跑 | worktree 按 ticketId 隔离（既有）+ `maxConcurrentPerRepo=2` 放行两单 | dispatcher「两单并行真跑隔离」六面断言 | ✓ |
| 2 | 声明相交：user 422 / system 排队后放行 | `ticket-service.ts:533-548`（actor 分流）+ `dispatcher.tryReleaseQueued:619-625` | api-s3 前两例 + ticket-service 文件集三例；**自动放行腿未端到端覆盖**（问题 3） | ✓（覆盖小缺） |
| 3 | 闸门限流 + FIFO 恢复 | `gateOccupancy` + `releaseAndRecheck`（queuedAt asc, id asc） | dispatcher「闸门=1 FIFO 依次唤醒」双证据 | ✓ |
| 4 | 饥饿免疫四路径 | 四挂载点：超时 FAILED:259 / 崩溃 FAILED:272 / preSpawnFail CANCELLED:431 / 卡点 BLOCKED:328 | dispatcher 四条独立真跑用例（另附 user 取消边、abort 直调两路径） | ✓ |
| 5 | 重试自愈（退避/上限升级/摘要） | `dispatcher.settle:332-370`（先判后等）+ `config.ts` 三键 | B6 逐档精确断言 + ticket-service 记账两例 | ✓ |
| 6 | 实测预警双留言 | `recordTouchedFilesAndWarn:378-414` + `ticket_files` 落库 | dispatcher「T1 未声明跑完 vs T2 声明相交」双留言 + 无关单不预警 + 状态不变 | ✓ |
| 7 | 重启恢复两类 | `recoverOnStartup:694-746` | dispatcher「到期即恢复 / 未到期不动 / 排队单重校验」 | ✓ |
| 8 | UI 三区分区 + 列表徽标 | 待处理区排队（`WorkbenchPage:253-257/290`）/ 裁决区 l3（`BlockedResolutionCard`）/ agent 只读倒计时（`WorkbenchPage:179-196`、`TicketDetailPage:183-210`）/ 列表徽标（`TicketListPage:129-146`） | 无前端自动化基建（项目现状）；build ✓ + 代码核读（hook 顺序、按钮禁用/隐藏、倒计时文案、徽标分流逐点对齐） | ✓ |
| 9 | 回归口径 + B6 更新 + fence 绿 | 存量测试零改动；B6 重写对齐新语义 | 175/175（Checker 独立复跑） | ✓ |
| 10 | Epic §9 三条映射 1/5/3 | 文档层映射（偏离 3 口径：user 拒绝 + system 排队） | 同 1/3/5 | ✓ |

## 偏差裁定（Builder 三条 + 块 2 发现项复核）

| # | Builder 偏差 | Checker 复核 | 裁定 |
|---|---|---|---|
| ① | `plannedFiles` 校验 400 VALIDATION（impl 写 422） | **实现正确**：AGENTS.md §四「API 入参校验统一 zod（routes 层 `parse()` 包装，`AppError.VALIDATION`）」+ `errors.ts:26` `VALIDATION: 400` 为全仓约定；impl 的「422」为文档笔误 | **接受实现**；**impl.md 勘误一行**（§块 1 `api-s3.test.ts` 行「submitSpec plannedFiles 校验 422」→ 400） |
| ② | 新增 `test/fixtures/fake-done-arg.mjs`（清单外） | **必要且正确**：双 fake worker 同时执行时进程级 env 无法区分实例，argv 参数化是唯一可行区分手段；仅测试夹具、产物名即断言钩子；`helpers.ts:143-149` 已记档归属 | **接受**；建议 **impl.md 测试清单补录**该 fixture 一行 |
| ③ | 闸门/占用集按 `type='TASK'` 过滤（spec 未显式限定） | **语义合理**：`createTicket:234-248` 保证非 TASK 的 `repoRef` 恒 null，而两函数对 null repoRef 直接短路（`627-628`/`653`），故该过滤实为等价防御（不改变任何可达结果），且明确「无执行语义类型不计入闸门」的意图 | **接受**；建议 **spec 规则 2 勘误**补一句口径（「两集合仅计 TASK」，与 spec 规则 4「排队不计入 retryCount」同族） |
| — | 块 2 发现项：`DashboardPage` / `StorySwimlane` 无排队徽标 | 验收 8 只枚举四处呈现面（待处理区 / 裁决区 l3 / 只读 RETRY_WAIT 卡 / 列表页徽标）；Dashboard 卡片与泳道卡均非验收面，且列表页 + 工作台 + 详情页三处排队入口齐备 | **不影响验收 8**；建议归后续 UI 迭代（与 S2w1 O1 泳道卡 repoRef 同族） |

## 发现的问题

### 1. 取消「排队中」的工单不触发队列重校验 → FILE_CONFLICT 排队单可滞留（无用户自助出口）—— 严重程度：medium

- 事实（行级锚定）：
  - 回调触发面写死两条边：`ticket-service.ts:583-594` 仅在 `to==='CANCELLED' && (fromStatus==='DISPATCHED' || fromStatus==='BLOCKED')` 时调 `onInflightReleased`；`SPEC_READY`(排队中)→`CANCELLED` 不在内（`ticket-service.test.ts:434` 用例「非挂载面不触发」把该行为显式固化）。
  - 但排队单**占文件集**：`ticket-service.ts:667-679`（`fileSetHolders` 含 `SPEC_READY + queuedReason` 非空行）。取消后排位释放，却没有任何重校验入口被触发（`dispatcher.ts` 八处直调、`recoverOnStartup` 全量扫描、5s tick 均不覆盖该边；tick 只处理 `BLOCKED+pendingLabel='agent'`，`642-655`）。
- 影响（最小可复现序列，纯 service 层可构造）：H=`BLOCKED` 持 `src/a.ts`（占文件集、不占闸门）；A=排队 `FILE_CONFLICT` 持 `src/`（与 H 相交）；B=排队 `FILE_CONFLICT` 持 `src/b.ts`（仅与 A 相交，与 H 不相交）。此时仓内无执行单、闸门空闲。用户取消 A（UI 允许：`TransitionActions.tsx:126-135` 仅对 DISPATCHED 禁用，CANCELLED 边可用）→ B 已满足全部放行前置，却无触发面唤醒；且 UI 对排队单**隐藏/禁用人工放行**（`WorkbenchPage.tsx:253-257`「排队中·自动放行」、`TransitionActions.tsx` disabled+Tooltip），用户无自助出口，只能等重启（`recoverOnStartup` 全量重校验）或同仓他单落定。
- 定性：实现**忠实于 spec 规则 5 的枚举字面**（「任何离开 {DISPATCHED, IN_PROGRESS} 的转移」未含 SPEC_READY 排队边），故属**规格层触发面缺口**而非实现偏离；但 spec 规则 3 既已把「取消」列为排队字段清空的出口之一，即隐含排队可经取消离场，触发面应与之一致。
- 建议（二选一即可闭合，建议 ①）：
  1. spec 勘误规则 5 + 一行修复：把 `SPEC_READY && queuedReason != null → CANCELLED` 纳入回调触发面，唤醒时同按 `workspace+repoRef` 定向重校验（`releaseAndRecheck` 已支持定向入参，无需新函数）；
  2. 备选：保留排队单的人工放行出口（不 disabled / 不隐藏），使「重走完整前置链」可由用户主动触发（代价是验收 8 的「不显示放行按钮」口径需同步放宽）。
- 说明：不影响验收 1-10 任一条（均未涉及排队单被取消的场景），故不阻塞验收；但属真实可用性缺口，建议随 spec 勘误一并修（修复量 ≈1 行 + 1 用例）。

### 2. 集成分支 merge commit 使用 git 默认英文主题 —— 严重程度：low

- 事实：`e881861` = `Merge branch 'dev/feat/atd-s3-web' into dev/feat/atd-s3-parallel-retry`（git 默认）；同仓先例均为中文描述式 merge（`893e053 合流 S2a 前端块（web UI 增量）`、`07eca11 merge: S1 核心域骨架合入 main…`、`3f3edae merge: 同步主仓 spec/impl 实证修订文档…`），用户全局规则要求 commit message 中文。与 S2w1 终检发现的同型问题一致。
- 影响：风格不合既有惯例，该 merge 将随分支进入 main 历史；无功能影响。
- 建议：① 若求严格一致可 `git commit --amend` 改写该 merge message（分支未推远端，改写安全；**须记录 hash 变更**并与本报告锚点对齐）；或 ② **推荐**不改历史，在合入 main 的最终 merge 上落规范中文说明（审计链零扰动）。

### 3. 验收 2 后半「system 通道排队单在前单落定后自动放行」缺端到端用例 —— 严重程度：low

- 事实：验收 2 的两条腿中，「user 422 拒绝」（`api-s3.test.ts:35-54` / `ticket-service.test.ts` 文件集用例）与「system 通道落队 `FILE_CONFLICT`」（`api-s3.test.ts:56-65`、`ticket-service.test.ts:324-335`）均有强断言；但「占位单落定 → 排队单自动放行并执行」这条腿无用例（`tryReleaseQueued` 的文件集分支 `dispatcher.ts:619-625` 仅在 GATE_QUEUED 场景下被端到端走通）。
- 影响：该分支与闸门分支共享 `releaseAndRecheck`/`tryReleaseQueued` 骨架（闸门分支已有 FIFO 真跑用例覆盖），回归风险低；但验收 2 的完整真值未被锁，后续重构该分支无护栏。
- 建议：补 1 例 dispatcher 用例（system 排队 `FILE_CONFLICT` → 前单真跑落定 → 排队单自动放行 DONE，断言 `note='排队唤醒，自动放行'` 且 `plannedFiles` 不相交后可执行）。

## 非扣分观察项

- **O1（spec 勘误·确认）** 偏差③ `type='TASK'` 过滤为等价防御（非 TASK 的 `repoRef` 恒 null，函数已对 null 短路），建议 spec 规则 2 补口径一句，见偏差表。
- **O2（impl 勘误）** 偏差①的 422→400、偏差②的 fixture 补录，共两处文档级修订，见偏差表；建议由调度者在 spec/impl 勘误动作中一并落（含问题 1 的规则 5 修订）。
- **O3（低风险观察）** `enqueue` 在 `workerId` 为 null 时也会落库（`ticket-service.ts:602-620`），而 `tryReleaseQueued:611-614` 见无 workerId 直接 return → 该单将滞留排队面无唤醒；生产 system 通道均保证预绑定（`dispatcher.ts:550` 检查、`onTicketSettled` 前置；`recoverRetryWait`/`resolveTicket` 边不涉排队），API 通道 `actor='user'` 经四件套必带 workerId → **当前不可达**。建议加一处防御（enqueue 前断言 workerId 非空）或留档，防后续调用点误用。
- **O4（设计口径观察）** FIFO 与编排链自动放行的优先序：`settle` DONE 内 `onTicketSettled`（`dispatcher.ts:301`）先于 `releaseAndRecheck`（`:302`），被解锁的下游可先占刚释放的闸门位，使排队更久的单再让一轮；链式下游逐个前插时排队单持续让位（DAG 有限 → 饥饿有界）。spec 未定义二者优先序，建议 spec 勘误中明确（若倾向队列优先，交换两行调用序即可，代价一行 + 相关用例复核）。
- **O5（代码整洁）** `helpers.ts:57-66` 的 `createTestContext` 上出现两段相邻 JSDoc 且首段内容与新增段重叠，建议合并为一段（零功能影响）。
- **O6（口径确认）** 排队单与 `retryCount` 的隔离正确：`enqueue` 不触碰计数、`recoverRetryWait` 唤醒只清 `retryAt` 保留计数、`clearRetry` 仅在人工 continue/reassign/reopen 与结算路径触发（`dispatcher.ts:479-492/519-524`），与 spec 规则 4/6 一致，且有直接用例锁定。
- **O7（实测防线口径）** `extractTouchedFiles` 取 `baseline..HEAD`（基线为 `worktree.baseline`），rename 取 git 显示路径、未提交改动不入清单——与 spec 规则 7「与 commit 提取同源」一致（同一 baseline 通道）；若要覆盖「未提交改动」需改 `git status --porcelain`，属范围外，留档即可。
- **O8（UI 面）** 块 2 发现项 `DashboardPage`/`StorySwimlane` 无排队徽标不影响验收 8，建议后续 UI 迭代；`QueuedTag` 已组件化，扩展成本极低。
- **O9（时间源一致性）** `settle` 内 `now` 用真实钟（`dispatcher.ts:250`，仅落 createdAt）而退避用注入钟 `this.now()`（`:354`）；生产 `now === Date.now` 等价、测试可接受，无行为影响（仅提示未来若统一时钟口径可一并收敛）。

## AGENTS.md 更新建议（交付后动作，本门不扣分）

1. §二新增「排队与并发治理」速查：闸门计数集 = 同 repo TASK 的 `DISPATCHED+IN_PROGRESS`（`maxConcurrentPerRepo` 默认 2，超出排队）；文件集占用集 = 前者 + `SPEC_READY` 排队中 + `BLOCKED`；排队承载 = 保持 `SPEC_READY` + `queuedReason`(`GATE_QUEUED`/`FILE_CONFLICT`)/`queuedAt`，**不走状态机零新增边**；两通道分流（闸门满两通道一律排队 / 文件冲突 user 422 `FILE_SET_CONFLICT`、system 排队）；`worker_id` 早绑定、重排队保 `queuedAt`。
2. §二新增「RETRY_WAIT 自愈」：报告缺失/schema 错 → `BLOCKED(pending:agent)` + `retryAt`，退避 60/120/240（`retryBackoffSec×2^(n-1)` 封顶 240），先判后等、超 `maxRetries`(3) 当次升级 `pending:l3` + 历次摘要；5s tick 到期恢复（闸门满顺延一 tick），`continue/reassign/reopen` 清零；`retryOnReportMiss` 已废弃（读到仅告警）。
3. §二状态机段补一行：`SPEC_READY` 队列语义（排队单为「随时可放行」单，四个 `plannedFiles`/`ticket_files` 相关表列）；错误码枚举补 `FILE_SET_CONFLICT`(422)。
4. §一结构树补 `apps/server/drizzle/0004_s3_parallel.sql`（5 列 + `ticket_files` 表）+ `config.yaml` 三键描述。
5. §三 spawn 坑位补一条：`plannedFiles` 的声明质量影响放行（声明 vs 声明）与 settle 预警（实测 vs 声明），worker 侧无需感知，但 spec 作者侧应尽量声明。
6. §五验证命令不变（fence 已覆盖 175 用例）。

## 状态落定

- 审查前实测 `.stage` = `QUALITY_GATE`（与质量门审查前状态一致）→ 本报告结论 **PASS**，落定目标态 **`DONE`**（`stage_set(to='DONE', actor='审查者')`）。
- 注：按 A 仓 07-state-machine 分工段，`QUALITY_GATE → DONE` 亦可由调度者终检汇合执行（终检双 PASS 后 DONE 归调度者）；本报告已按任务书以审查者身份落定，若状态机拒绝该边，则转由调度者执行同一步转移，本报告技术结论不受影响。

## 结论

# PASS

状态：QUALITY_GATE → DONE

一句话理由：三条主线（plannedFiles 双层防线 / 排队治理双集合 / RETRY_WAIT 自愈先判后等）逐面落码核对与 impl 一致，八直调 + 两回调 + 启动扫描挂载清单完备且与用例一一对应，饥饿免疫四路径、退避 60/120/240 逐值、FIFO 恢复、重启恢复两类、实测预警双留言、双 fake worker 真跑隔离均有强断言用例锁定；migration 0004 + D4 快照链经结构比对与「每库跑全链 migrate」双重实证；Checker 独立复跑 191/191 全绿（server 175 + web build + 三包 tsc）+ `git status` 干净；三条 Builder 偏差复核全部接受（① 400 正确、② fixture 必要、③ type 过滤等价），块 2 发现项不影响验收 8；遗留 1 medium（排队单取消不触发重校验，规格层触发面缺口，建议 spec 勘误 + 一行修复）+ 2 low（merge 英文主题 / 验收 2 后半放行腿无用例），均不阻塞用户验收 —— 91/100 PASS。
