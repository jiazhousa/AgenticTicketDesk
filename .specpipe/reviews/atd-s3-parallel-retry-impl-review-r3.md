# 审查报告: atd-s3-parallel-retry — Impl (Revision 3)

- **类型**：Story Impl 完整审查（S-S8 第三轮，编码前最后一道）
- **审查对象**：`.specpipe/plans/atd-s3-parallel-retry/impl.md`（v3，99 行）
- **上一轮**：`atd-s3-parallel-retry-impl-review-r2.md`（REJECT 47/100：critical×1 / medium×4 / low×4）
- **基准**：同目录 `spec.md`（v3.1，SPEC_APPROVED；验收 1-10 / 业务规则 1-10 / 偏离清单 6 条）
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（main@8456548，只读）
- **核对方式**：`dispatcher.ts` 全文（15 处 transition 调用点逐条穷举）、`domain/status.ts`（TRANSITIONS / isUserEdge）、`domain/ticket-service.ts`（TransitionOptions / transition / submitSpec / bumpRound）、`app.ts`（装配顺序 + RuntimeOptions）、`index.ts`、`routes/{tickets,execution,types}.ts`、`report.ts`、`config.ts`、`db/schema.ts`、`test/helpers.ts`、`test/dispatcher.test.ts`、`web/src/{api/tickets.ts,api/types.ts,components/{TransitionActions,SpecCard,DispatchForm}.tsx,pages/{WorkbenchPage,TicketDetailPage}.tsx}`
- **状态校验**：`.stage` = `IMPL_REVIEWING` ✓（与派发口径一致）
- **日期**：2026-09-25

## 总体评价

**不通过**——r2 的 critical 已实质闭合：v3 把唤醒挂载面从「五处」补到**八处直调 + 两条 user 取消边回调 + 启动扫描**，经本轮对 `dispatcher.ts` 全量 transition 调用点（15 处）与 `TRANSITIONS`/`isUserEdge` 的穷举对照，**挂载清单判定为完备**（详见「附加终审点」1）；回调契约（setter 注入 + 装配顺序事实修正 + 枚举两条 user 边 + abort 归 dispatcher 直调 + 提交后 fire-and-forget）与代码事实逐条吻合；排队校验顺序（四件套先行）与唤醒重查范围、D9 tick 恢复语义均写死且与本仓既有 actor 分流/四件套语义自洽；seam 通路（tickIntervalMs/now）三跳贯通；块 2 补 `TransitionActions.tsx`；三条 low（startRound 结构改造、report.ts 表述中性化、api-s3.test.ts 定名）已闭合。八处直调的行号引用（:222/:231/:270-294/:315/:323/:361）经复核全部准确。

但 v3 在 r2-low#7「升级判定时点」上**反向写死**了一个与验收 5 冲突的口径（`递增后当次判 >= maxRetries` ⇒ 默认 maxRetries=3 下 240 档不可达，实际只出现 60/120），且与 impl 自身测试行「退避 60-120-240」自相矛盾；r2-m4 的 `plannedFiles` 录入入口**错位到 `SpecCard.tsx`**（该组件走 PATCH `updateTicket`，真正的 `submitSpec` 提交弹层在 `TransitionActions.tsx:88` 与 `WorkbenchPage.tsx:80`）；另有 4 处 low（tick 生命周期/清理钩子、回调裸方法引用丢 `this`、排队字段取消清空未写、tick 每单异常隔离）。问题仍全部是文档层修订，可在小时级收敛。

## 质量评分

**80 / 100**（medium ×2 = −10 / low ×5 = −10）

## r2 → v3 逐项闭合核验

| r2 # | 级别 | r2 问题 | v3 处置（含代码核对） | 判定 |
|---|---|---|---|---|
| 1 | critical | 唤醒挂载集漏 settle 卡点 BLOCKED + 测试行被「前单 DONE」替换 | 技术方案 5 重写为「八处直调 + 两回调 + 启动扫描」：DONE/DONE-超时/DONE-崩溃/**settle-BLOCKED-卡点（:282）**/settle-BLOCKED-RETRY_WAIT（:301）/preSpawnFail→CANCELLED（:316）/**preSpawnFail→FAILED（:323）**/abort→FAILED（:361）；测试行四路径改回「超时 FAILED / 崩溃 FAILED / preSpawnFail CANCELLED / **卡点 BLOCKED**」 | **已闭合**——行号引用逐条复核准确；对照 `dispatcher.ts` 15 处 transition 穷举无第五种遗漏（见终审点 1） |
| 2 | medium | 回调契约（谓词/枚举/事务边界/签名/装配形态） | D2：setter 注入（「service 先于 dispatcher 构造」= `app.ts:93` vs `:99` 属实）+ 枚举仅两条 user 取消边（`status.ts:48` DISPATCHED→CANCELLED、`:49` BLOCKED→CANCELLED）+ abort 归 dispatcher 直调（`resolveTicket` 确为 `Dispatcher` 方法 `:339`，内部调 `service.transition` `:361`）+ 提交后 fire-and-forget 异常 log 不抛 | **已闭合**（绑定形态残留 → 新 L2） |
| 3 | medium | 排队/唤醒校验顺序与通道、tick 内异常传播 | 技术方案 4：四件套先行（workerId→∈Registry→worktree→repoRef 复校[仅 user]）→ 闸门/文件集；唤醒仅重查 Registry∈+闸门+文件集（不重查 worktree/repoRef，system 语义）；D9 tick 恢复顺序（闸门先行 / retry_at 顺延 / 文件集不复验）。actor 载体引用 `ticket-service.ts:78-90` / `routes/tickets.ts:133` / `dispatcher.ts:438` / repoRef 仅 user 分支 `:450` 全部属实 | **部分闭合**——校验顺序与通道写死 ✓；r2-m2 第 3 项「tick/唤醒循环每单 try/catch 隔离」未采纳 → 新 L3 |
| 4 | medium | 测试 seam 注入通路未贯通（helpers 无 opts、RuntimeOptions 未扩） | 技术方案 8：`tickIntervalMs`/`now` 扩 dispatcher 构造 opts，通路 test→helpers→app.ts→Dispatcher；helpers 行补「工厂扩 DispatcherOptions 透传 + 双并行 fake worker」 | **部分闭合**——通路方向正确且可行（`helpers.ts:163-173` 已向 `buildServer` 透传 opts）；但 helpers 行未列 config 三键注入位（`config.ts:73-77`/`:164-168` 现存字面量必随 AppConfig 扩字段而改），且术语漂移（`DispatcherOptions`→实为 `DispatcherDeps`；「AppRuntime 构造」→实为 `RuntimeOptions`/`buildServer`）→ 新 L5 |
| 5 | medium | 块 2 缺 `TransitionActions.tsx`；plannedFiles 录入入口未声明 | 块 2 补 `TransitionActions.tsx`（排队单禁用放行+QueuedTag，:61）与 `SpecCard.tsx`（plannedFiles 文本域，:60） | **部分闭合**——`TransitionActions` 已入清单 ✓；但 `plannedFiles` 错位到 `SpecCard`（该组件调 `updateTicket`/PATCH，非 `submitSpec`）→ 见 M2 |
| 6 | low | startRound while/runOnce 返回值改造未列 | 改动点 `dispatcher.ts` ②：「移除 startRound 内立即 bumpRound+respawn 循环（现状 L2 分支的 while/续跑结构一并改造为单次返回 RETRY_WAIT 结果）」 | **已闭合**——点名 `startRound`、while/续跑结构与返回值形态（`dispatcher.ts:68-71`/`:75` 对应） |
| 7 | low | 升级判定时点二义（240 档是否被观察） | D6「**递增后当次判升级**」+ 技术方案 6「递增后当次立即判 `retry_count >= maxRetries`，达限则当次同态升级」 | **未闭合（反向写死）**——该口径即 r2 警告的「进入 RETRY_WAIT 时判定」，默认 maxRetries=3 下 240 档不可达，且与测试行「退避 60-120-240」冲突 → 见 M1 |
| 8 | low | `report.ts`「同源 execGit 通道」表述不实 | impl:42 改「复用本文件既有 git 调用通道，与 commit 提取同源」+ 参数 `(repoPath, baselineSha, headSha)` | **已闭合**（`report.ts:44-48` 确为内联 `execFileSync('git', …)`，无 `execGit` 助手；新表述中性） |
| 9 | low | `routes/types.ts` 指向不存在的 `SubmitSpecBody`；测试文件名未定；验收 9 措辞 | impl:44 明注「submitSpec 入参为 routes 层内联 zod，不新增独立 Body 类型」；测试定名 `api-s3.test.ts`（:49，先例 `api-s2a.test.ts`）；契约冻结节+风险表承接兼容口径 | **已闭合**（残留：:44 前半句仍把 5 字段增量挂在 `routes/types.ts`——该文件为纯 re-export，字段实定义在 `ticket-service.ts` 域类型，impl:38 ⑦ 已覆盖 → 观测级） |

## 附加终审点结论

### 1. 挂载清单完备性（最终裁定）

以 `dispatcher.ts` 全文 15 处 `service.transition` 调用点 + `status.ts` `TRANSITIONS`/`isUserEdge` + `routes/tickets.ts:132` 为准，穷举「离开 {DISPATCHED, IN_PROGRESS}」的全部代码路径：

| 源 → 目标 | 代码位置 | actor | v3 归属 | 判定 |
|---|---|---|---|---|
| IN_PROGRESS→DONE | `dispatcher.ts:265` | system | 直调① | ✓ |
| IN_PROGRESS→FAILED（超时） | `:223` | system | 直调② | ✓ |
| IN_PROGRESS→FAILED（崩溃） | `:235` | system | 直调③ | ✓ |
| IN_PROGRESS→BLOCKED（报告 blocked/卡点） | `:282` | system | 直调④ | ✓（r2-critical 补） |
| IN_PROGRESS→BLOCKED（报告缺失→RETRY_WAIT 入口） | `:301` | system | 直调⑤ | ✓ |
| DISPATCHED→CANCELLED（preSpawnFail） | `:316` | system | 直调⑥ | ✓ |
| IN_PROGRESS→FAILED（preSpawnFail） | `:323` | system | 直调⑦ | ✓（r2 补） |
| BLOCKED→FAILED（abort） | `:361` | system | 直调⑧ | ✓（离开 BLOCKED 释放占用集声明，合理外延） |
| DISPATCHED→CANCELLED（user 取消） | `routes/tickets.ts:132` 经 `service.transition` | user | service 回调 | ✓ |
| BLOCKED→CANCELLED（user 取消） | 同上（`status.ts:49`） | user | service 回调 | ✓ |
| IN_PROGRESS→FAILED（重启） | `dispatcher.ts:463` | system | 启动扫描 | ✓ |
| DISPATCHED→CANCELLED（重启） | `:470` | system | 启动扫描 | ✓ |
| DISPATCHED→IN_PROGRESS / BLOCKED→IN_PROGRESS / BLOCKED→DISPATCHED | `:179`/`:364`/`:368` | system | —（进入执行态，非释放） | ✓ 正确不挂载 |
| SPEC_READY→DISPATCHED（自动放行）/ 终态→DISPATCHED（重开） | `:438`/`:399` | system/user | —（占用集入边） | ✓ 正确不挂载 |
| SPEC_READY+CANCELLED（排队单取消，释放占用集声明） | `routes/tickets.ts:132` | user | — | ⚠ 规格层外延（规则 5 不含 SPEC_READY 出边，与 r2 观测 4 同）——非 impl 缺陷 |

**结论：完备**。八直调 + 两回调 + 启动扫描覆盖了「离开 {DISPATCHED, IN_PROGRESS}」的全部现存代码路径，无第五种遗漏；`resolveTicket` continue→IN_PROGRESS（`:364`）与 reassign→DISPATCHED（`:368`）为**重入执行**（占用集内部迁移：BLOCKED 声明保留、闸门位由空闲转为占用），不需挂载的判断正确；`status` 列的全部写入点仅 `ticket-service.ts:473`（transition 单一咽喉）与 `:390`（submitSpec DRAFT→SPEC_READY），无旁路写。

### 2. 契约冻结 vs spec v3.1 规则 8/9 逐字段

| 字段 | spec | v3 契约冻结 | 判定 |
|---|---|---|---|
| `FILE_SET_CONFLICT` | 规则 8：入 `errors.ts` 封闭 union（422） | impl:36/71：422 + `details: ['单 N 与单 M 文件集相交: …']` | ✓（`errors.ts:2-43` 确为封闭 union + 全量 `ERROR_STATUS`，tsc 强制两处同步，impl:36 已列） |
| `queuedReason` | 规则 9 + 范围 28：`GATE_QUEUED`/`FILE_CONFLICT` | impl:72：`'GATE_QUEUED'\|'FILE_CONFLICT'\|null` | ✓ |
| `queuedAt/retryCount/retryAt/plannedFiles` | 规则 9 | impl:72：`number\|null / number / number\|null / string[]\|null` | ✓（`planned_files` TEXT-JSON ↔ `string[]\|null` 往返在 ③，读侧 detail/list 还原） |
| `POST /api/tickets/:id/spec` body | 规则 9 / 范围 26：`{specContent, plannedFiles?}` | impl:73：`{specContent, plannedFiles?: string[]}`（routes 层内联 zod） | ✓（`routes/tickets.ts:57` 确为局部 `specBody` 内联 zod） |
| 放行响应不变 | 验收 9 | impl:70：`{ticket}` 不变 | ✓（`routes/tickets.ts:140` 现返回裸 ticket） |

### 3. 块 1 / 块 2 文件集不相交终核

块 1 = `apps/server/{src,drizzle,test}/**` + `config.yaml`；块 2 = `apps/web/src/**`。**无交集**。新增归属核对：`test/api-s3.test.ts` → 块 1（:49）✓；`components/SpecCard.tsx` / `components/TransitionActions.tsx` → 块 2（:60/:61）✓；两处 `types.ts`（`apps/server/src/routes/types.ts` 与 `apps/web/src/api/types.ts`）路径不同，各归其块 ✓。

## 发现的问题

### medium

1. **D6「递增后当次判 `>= maxRetries`」与验收 5「60/120/240 退避」及自身测试行「退避 60-120-240」冲突——默认 maxRetries=3 下 240 档不可达** — 严重程度：medium
   - 位置：impl:82（D6）、impl:22（技术方案 6「递增后当次立即判」）、impl:48（测试行「退避 60-120-240（注入 now 构造）」）；对照 `spec.md:50`（验收 5）、`:64`（规则 6）、`:34`（范围「60×2^retryCount 封顶 240」）
   - 描述：按 v3 写死的口径展开（retry_count 首次=1，`>=` 且超限当次升级）：失败 #1 → count=1（1<3，retry_at=60×2⁰=60）；失败 #2 → count=2（2<3，retry_at=120）；失败 #3 → count=3（3≥3，**当次升级，不再排 retry_at**）。可观察到的等待序列只有 **60 → 120**，共 2 次实际 retry、3 次尝试，**240 档永不出现**，`min(…, 240)` 的封顶分支成为死配置——这正是 r2-low#7 明确警告的方向（「进入 RETRY_WAIT 时判定 ⇒ 240 档不会出现」）。同时与 impl:48 自己的测试断言「退避 60-120-240」自相矛盾：Builder 依 D6 实现则该用例必挂（除非额外把 maxRetries 配成 4，但 impl 未声明，且默认 3 的行为仍不含 240）。
   - 影响：验收 5 的「连续失败按 60/120/240 退避」无法达成/无法验证；实现与测试两端会各自拍板，产出「实现绿、验收不达标」或「测试与规则不符」。
   - 建议：二选一写死其一（建议后者，最小改动且贴合验收 5 字面）：①判据改为「到点（retry_at 到期）且 `retry_count >= maxRetries` 才升级」，即 count=1/2/3 分别等 60/120/240，第 3 次到期直接升级（不再 spawn）——与 r2-low#7 建议一致；并把 impl:22 的「递增后当次立即判」同步改掉。②或保留当次判定但把判据改 `retry_count > maxRetries` 并同步说明默认 3 对应「3 次 retry 后升级」。无论哪种，impl:48 的「60-120-240」断言需与所写口径对齐（含 maxRetries 注入值）。

2. **块 2 的 `plannedFiles` 录入入口错位：`SpecCard.tsx` 走 PATCH `updateTicket`，真正的 `submitSpec` 提交弹层在 `TransitionActions.tsx` 与 `WorkbenchPage.tsx`** — 严重程度：medium
   - 位置：impl:60（SpecCard 行：「spec 提交表单增文本域…**随 submitSpec 提交**」）；对照 `web/src/components/SpecCard.tsx:8`（注释「『提交 spec』动作在 TransitionActions」）、`:30-34`（调 `updateTicket` = PATCH）、`components/TransitionActions.tsx:87-88`（`submitSpec(ticket.id, specContent.trim())`，spec 弹层在 `:139-159`）、`pages/WorkbenchPage.tsx:80`（另一处 `submitSpec` 调用）
   - 描述：`SpecCard` 是 DRAFT 期**编辑**卡（title/description/specContent，走 `updateTicket`→`PATCH /api/tickets/:id`），而 `plannedFiles` 契约只挂在 `POST /api/tickets/:id/spec`（impl:73）上，现有 `patchBody`（`routes/tickets.ts:49-55`）也不含该字段。Builder 若照 impl:60 字面把文本域加进 `SpecCard` 的编辑弹层，只能走 PATCH——要么违约扩 `patchBody`（违反契约冻结与 spec 范围 26「与 specContent 同一入口同一时机」），要么该录入面成为死 UI（提交后 `plannedFiles` 从未随 `submitSpec` 上送）。此外 v3 未提 `WorkbenchPage.tsx:80` 的第二个 `submitSpec` 弹层；impl:61 括注「详情页与工作台共用组件」亦不实——`WorkbenchPage` 自渲染放行按钮（`WorkbenchPage.tsx:199-236`），并不使用 `TransitionActions`（全仓仅 `TicketDetailPage.tsx:150` 引用）。
   - 影响：`plannedFiles` 的 UI 录入落点错误（指向错误端点），人工单声明能力缺失或契约被破坏；r2-m4 的「录入入口决策」实质未落地。
   - 建议：把 plannedFiles 文本域挂到**提交 spec 弹层**——`TransitionActions.tsx` 的 `modal==='spec'` 弹层（`:139-159`）并同步 `WorkbenchPage.tsx` 的 spec 弹层（`:284-293`）；`SpecCard` 仅在 SPEC_READY 后**只读展示** plannedFiles。同时删除 impl:61 的「工作台共用组件」括注（改为「工作台需平行处理，见 WorkbenchPage 行」）。

### low

3. **tick 的挂载/清理钩子未写死：`AppRuntime` 无生命周期对象，测试上下文无 teardown 点** — 严重程度：low
   - 位置：impl:40（「tick 挂载/清除进 `AppRuntime` 生命周期」）、impl:79（D3）；对照 `app.ts:18-26`（`AppRuntime` 为纯数据对象，无 start/stop/close）、`helpers.ts:78-96`/`:163-185`（测试上下文创建后无任何 dispose）、`test/workspace-contract.test.ts:237`（仓内唯一 `.close()` 用法）
   - 描述：`AppRuntime` 现无生命周期钩子，「进 AppRuntime 生命周期」无可落点；每个 `createTestContext`/`createRealContext` 都会 `buildServer`，若在构造期无条件 `setInterval`，则每个用例都留一个不清理的定时器（小 `tickIntervalMs` 用例下会在断言间非预期触发 `releaseAndRecheck`，污染时序；默认 5s 则长期 ref 住事件循环）。v3 未写「由谁 clear、何时 clear、测试如何禁用/收敛」。
   - 建议：写死清理通道（如 `app.addHook('onClose', …)` + `RuntimeOptions.tickIntervalMs=0 ⇒ 不挂载`，或 `Dispatcher.dispose()` 并在 `buildServer` 返回值上暴露）；定时器按 `execution.ts:104-106` 既有惯例 `.unref()`；测试用例显式注入小 `tickIntervalMs` + 用后 `clear`。

4. **回调接线 `service.onInflightReleased = dispatcher.releaseAndRecheck` 为裸方法引用，丢失 `this`；且与回调类型 `(ticketId) => void` 的形参不一致** — 严重程度：low
   - 位置：impl:40（app.ts 行）与 impl:20（回调契约 `service.onInflightReleased = (ticketId) => void`）、impl:19（`releaseAndRecheck()` 无参）
   - 描述：`Dispatcher` 的实现依赖 `this.deps`（`dispatcher.ts:42`），把方法裸引用赋给 service 字段后调用即丢 `this` → `Cannot read properties of undefined (reading 'deps')`，且 tsc 不会报错（仅在 user 取消边运行期暴露）；同时 r2-m1-③ 要求统一的签名（`releaseAndRecheck(ticketId?)`，参数仅作来源标记）在 v3 仍为「契约有新参、实现无参」。
   - 建议：接线写成 `service.onInflightReleased = (id) => dispatcher.releaseAndRecheck(id)`，或把 `releaseAndRecheck` 定义为类字段箭头函数；并在技术方案 5 统一签名（无参或可选参二选一）。

5. **排队字段清空时机只写了 DISPATCHED 侧，spec 规则 3 要求的「取消（CANCELLED）时清空」未写** — 严重程度：low
   - 位置：impl:38（⑤「DISPATCHED（放行成功）时清空 queued 两字段」）；对照 `spec.md:61`（排队生命周期：「排队字段在成功放行（DISPATCHED）**或取消（CANCELLED）**时清空」）
   - 描述：排队单为 SPEC_READY+queued 两字段，其取消走 `SPEC_READY→CANCELLED`（user 边，不在两条回调枚举内）；v3 未声明该转移清 `queued_reason/queued_at`，会留残值（终态单携带 stale `queuedReason`，前端按 `status===SPEC_READY && queuedReason` 判定虽不误显示，但契约字段失真、后续复查困难）。
   - 建议：在 ⑤ 补「任何离开 SPEC_READY 的转移（DISPATCHED 放行成功 / CANCELLED）清空 queued 两字段」，或直接写「SPEC_READY 出边统一清空」。

6. **唤醒/tick 循环的每单异常隔离未写（r2-m2 第 3 项未采纳）** — 严重程度：low
   - 位置：impl:19（`releaseAndRecheck()` FIFO 整轮）、impl:22（5s tick 扫到期单）；对照 `dispatcher.ts:425-448`（`onTicketSettled` 对下游单逐条 try/catch，既有惯例）、`domain/ticket-service.ts:434-436`（`to==='DISPATCHED'` 先过 `assertDependenciesDone`，可抛 `BLOCKED_BY_PENDING`）
   - 描述：`addDependency` 不校验状态、终态单可 reopen，故「排队单在排队期依赖被破坏」可达——唤醒时 `service.transition(…,'DISPATCHED')` 抛异常将中断整轮，使本轮其余排队单/到期重试单全部饥饿，与规则 5 的单入口收敛目标相悖。
   - 建议：写死「tick 与 `releaseAndRecheck` 均按单 try/catch，失败 `console.error` 留痕并继续下一单（对齐 `onTicketSettled` 既有形态）」。

7. **`helpers.ts` 行未列 config 三键注入位；seam 术语漂移（`DispatcherOptions`/`AppRuntime 构造`）** — 严重程度：low
   - 位置：impl:45（helpers 行）、impl:24（技术方案 8）；对照 `helpers.ts:73-77`/`:164-168`（`AppConfig` 字面量内联构造，AppConfig 扩三键后必改）、`dispatcher.ts:20`（类型实为 `DispatcherDeps`）、`app.ts:29-40`（透传入参类型为 `RuntimeOptions`，非 `AppRuntime`）、`app.ts:40`（app.ts 行未列 `RuntimeOptions` 扩 tickIntervalMs/now）
   - 描述：acceptance 3 需 `maxConcurrentPerRepo=1`、acceptance 5 需 `maxRetries/retryBackoffSec` 可控，但 helpers 行只写 dispatcher 侧 `tickIntervalMs/now` 透传，未写 config 三键注入；impl:24 的通路术语指向了不存在的类型名（`DispatcherOptions`）与错误层次（`AppRuntime 构造` 应为 `RuntimeOptions→buildServer`），app.ts 行亦未同步列 RuntimeOptions 扩字段。
   - 建议：helpers 行补「config ops 扩 `maxConcurrentPerRepo/maxRetries/retryBackoffSec`」；术语对齐 `DispatcherDeps` / `RuntimeOptions`（`buildServer` 透传），并在 app.ts 行补「`RuntimeOptions` 扩 `tickIntervalMs?/now?` 并透传 Dispatcher」。

## spec→impl 覆盖核对（本轮变化行，其余与 r2 一致）

| 基准项 | impl 落点 | 判定 |
|---|---|---|
| 验收 4 饥饿免疫四路径 | 技术方案 5 八直调 + 测试行四路径齐（超时/崩溃/preSpawnFail/卡点 BLOCKED） | ✅（r2-critical 闭合） |
| 规则 5 唤醒触发面（单入口收敛） | 八直调 + 两 user 回调 + 启动扫描，穷举完备 | ✅（SPEC_READY 出边外延见观测 1） |
| 验收 5 重试自愈（60/120/240 → 升级） | 技术方案 6 + D6 + ④ 参数化 | ❌ 升级时点与 240 档冲突（M1） |
| 规则 3 排队生命周期（校验顺序/清空/唤醒） | 技术方案 4 + ⑤ + D9 | ⚠ 唤醒校验顺序 ✓；取消清空未写（L5）；每单隔离未写（L6） |
| 规则 9/10 契约与 UI | 契约冻结节 + 块 2 七项 | ⚠ plannedFiles 录入落点错误（M2） |
| 验收 2 system 通道文件冲突排队 | 技术方案 1/2 + ③（actor 分流） | ✅ |
| 验收 3 闸门 FIFO | ① 早绑定 + ⑧ FIFO | ✅（测试构造依赖 L7） |
| 验收 7 重启恢复 | ⑥ `recoverOnStartup`（RETRY_WAIT 到期即恢复 + 排队重校验） | ✅（`index.ts:27` 早于 `listen`，impl:41 核对正确） |
| 验收 9 回归口径 | D7/D8 + 风险表 | ✅ |

## 技术决策速评（D1-D9）

| 决策 | 判定 | 说明 |
|---|---|---|
| D1 排队承载=独立列 + 早绑定 | ✅ | queue≠blockReason，与规则 3/偏离 2 一致 |
| D2 回调=setter 注入 + 两 user 边 + 提交后 fire-and-forget | ✅ | 装配顺序（`app.ts:93`<`:99`）、`resolveTicket` 归属（`:339`）、abort actor=system（`:361`）全部属实；接线形态见 L4 |
| D3 tick=setInterval + opts seam | ⚠ | seam 声明正确，挂载/清理钩子见 L3 |
| D4 snapshot 修复四步 + fallback | ✅ | 现状复核属实（`drizzle/meta/` 止于 `0002_snapshot.json`，`_journal.json` 有 0003 entry） |
| D5 `retryOnReportMiss` optional warn + 删键 | ✅ | `config.ts:22` 现存字段，改 optional 读取位可行 |
| D6 退避口径 | ❌ | 「递增后当次判」⇒ 240 不可达，与验收 5 冲突（M1） |
| D7 复用 `actor` 判通道 | ✅ | 载体四处引用逐条核实（`:78-90`/`:133`/`:438`/`:450`） |
| D8 校验作用域限新放行边 | ✅ | 仅 SPEC_READY→DISPATCHED；R4 记档 |
| D9 tick 恢复语义 | ✅ | 闸门先行 / retry_at 顺延不落 queued / 文件集不复验（占用单调）与 spec 规则 6 不冲突，论证成立 |

## 观测（不计分）

1. **SPEC_READY 出边释放缺口（规格层）**：排队单被取消（SPEC_READY→CANCELLED）会释放其占用集声明，理论上可解锁与之相交的另一 FILE_CONFLICT 排队单，但规则 5 的触发面不含 SPEC_READY 出边 → 无触发点；impl 忠实于 spec，建议 spec 后续复评（与 r2 观测 4 同）。
2. **`onTicketSettled` 自动放行的返回值语义**：`dispatcher.ts:438-442` 现写法假定 `service.transition(...,'DISPATCHED')` 必转成功；新增闸门后该调用可能返回「仍为 SPEC_READY 的排队单」，随后 `onDispatched`→`startRound`→`runOnce` 会在 `:80-82` 早退（无害空转）。建议 impl 增一句「自动放行路径按返回值判 status 再 spawn」，避免误解为必然派发。
3. **B6 现状确认**：`dispatcher.test.ts:262-284`（`retryOnReportMiss:1`，断言 `round=2`/`pendingLabel='l3'`）存在，impl:48 已列「B6 更新」，语义更新面吻合。
4. **`routes/types.ts` 为纯 re-export**（`:15-16`）：impl:44 的「TicketListItem/TicketDetail +字段」实落 `ticket-service.ts` 域类型（impl:38 ⑦ 已覆盖），此行属表述冗余，非缺口。

## 结论

# REJECT

状态：IMPL_REVIEWING → IMPL_DRAFT

一句话理由：r2-critical（唤醒挂载面）经本轮对 `dispatcher.ts` 全量 transition 调用点的穷举判定为**已完备闭合**，回调契约/校验顺序/seam/块 2 补件等多半闭合；但 v3 把 r2-low#7「升级判定时点」反向写死成与验收 5（60/120/240）冲突且与自身测试行矛盾的口径（默认 maxRetries=3 下 240 档不可达），`plannedFiles` 录入入口错位到走 PATCH 的 `SpecCard`（真提交弹层在 `TransitionActions`/`WorkbenchPage`），另有 tick 清理钩子、回调裸引用丢 `this`、取消清空、每单异常隔离、helpers config 注入位共 5 处 low——均属文档层修订，再一轮可收敛。
