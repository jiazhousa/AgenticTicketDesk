# 审查报告: atd-s3-parallel-retry — Impl (Revision 4)

- **类型**：Story Impl 完整审查（S-S8 第四轮，终审轮）
- **审查对象**：`.specpipe/plans/atd-s3-parallel-retry/impl.md`（v4，99 行）
- **上一轮**：`atd-s3-parallel-retry-impl-review-r3.md`（REJECT 80/100：medium×2 / low×5，挂载清单经穷举裁定完备）
- **基准**：同目录 `spec.md`（v3.1，SPEC_APPROVED；验收 1-10 / 业务规则 1-10 / 偏离清单 6 条）
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk`（main@e1867bb，v4=docs-only commit，业务代码未变；只读）
- **核对方式**：v4 全文逐行 + 代码事实抽查——`app.ts` 全文（AppRuntime/RuntimeOptions/buildApp/buildServer/装配顺序）、`dispatcher.ts` 15 处 `transition` 调用点行号复核、`dispatcher.ts:20` 类型名、`domain/ticket-service.ts`（actor:80 / pendingLabel 硬编码:475 / SPEC_READY:390 / repoRef 仅 user:450）、`test/helpers.ts` config 字面量、`test/dispatcher.test.ts` B6、`web/src/{components/SpecCard.tsx, components/TransitionActions.tsx, pages/WorkbenchPage.tsx}`、`web/src/{components/BlockedResolutionCard.tsx, utils/hooks.ts}`
- **状态校验**：`.stage` = `IMPL_REVIEWING` ✓（与派发口径一致）
- **日期**：2026-09-25

## 总体评价

**通过**——r3 的两项 medium 全部实质闭合（D6 退避口径重写为「先判后等」，默认 maxRetries=3 下 60/120/240 三档全可达且三次重试后升级，与验收 5、业务规则 6 的落点及 impl 自身测试行三方对齐；`plannedFiles` 录入入口从走 PATCH 的 `SpecCard` 正确迁到 `submitSpec` 提交点 `TransitionActions:88` + `WorkbenchPage:80`，`SpecCard` 降为只读）。r3 的两条 low（取消清空 queued、tick 每单异常隔离）已实质闭合，另三条 low（onClose 清理钩子、回调箭头包裹、helpers config 三键）主项已落。

全文复扫**无编辑残留/重复行/块间文件集冲突**；术语面「闸门计数集/文件集占用集/RETRY_WAIT/pending:agent/八处直调+两回调+启动扫描」全篇一致，`FILE_SET_CONFLICT`/5 新字段契约与 spec 规则 8/9 逐字段吻合，块 1（`apps/server/**`+`config.yaml`）/块 2（`apps/web/src/**`）文件集仍不相交。

残余 **4 项 low**（无 medium+），全部为文档层术语/签名口径与一处编辑残留，不改变实现路径正确性：①`D3` 仍写「`AppRuntime` 挂载/清除」与 `app.ts` 行「`AppRuntime` 无生命周期概念」自相矛盾；②seam 术语未对齐（`DispatcherOptions` → 实为 `DispatcherDeps`；「`app.ts` `AppRuntime` 构造」→ 实为 `RuntimeOptions`→`buildServer`）；③`releaseAndRecheck` 接线传实参 vs 实现署名无参（r3-l2「统一签名」未落）；④r3-l4 仅给 tick 加了每单 try/catch，唤醒轮 `releaseAndRecheck` 的每单隔离未明写。按本仓惯例（仅余 low 无 medium+）给 PASS。

## 质量评分

**92 / 100**（low ×4 = −8）

## r3 → v4 逐项闭合核验

| r3 # | 级别 | v4 处置 | 代码事实核对 | 判定 |
|---|---|---|---|---|
| M1 退避 240 不可达 | medium | D6（:82）+ 技术方案 6（:22）统一改「递增后 `retry_count > maxRetries` 当次升级，否则安排 `min(retryBackoffSec×2^(retry_count-1), 240)`」 | 验算 maxRetries=3：count1(1>3?否)→60 / count2→120 / count3→240 / count4(4>3)→升级；三档全可达 + 三次重试后升级；impl:48 测试行「退避 60-120-240（注入 now 构造）」与「maxRetries 边界断言当次升级」自洽；对齐 spec 验收 5 与规则 6 落点 | **已闭合** |
| M2 plannedFiles 录入错位 | medium | :60 `SpecCard` 改**只读展示**并明注「不走 `PATCH updateTicket`」；:61 录入入口迁 `TransitionActions` spec 提交弹层（约 :88）；:62 `WorkbenchPage` 快捷提交（约 :80）同步增文本域；删除 r3 指出的不实「详情页与工作台共用组件」括注 | `SpecCard.tsx:3` import `updateTicket`、`:30-34` 确调 `updateTicket`（PATCH）✓；`TransitionActions.tsx:87-88` 确为 `submitSpec(ticket.id, specContent.trim())`、spec 弹层 `:139-159` ✓；`WorkbenchPage.tsx:80` 确为第二处 `submitSpec`、spec 弹层 `:278-297` ✓；r3 指认的括注已删除 ✓ | **已闭合** |
| L1 tick 清理钩子 | low | :40 `app.ts` 行改「tick 挂载=buildApp 构建 Dispatcher 时启动，清理挂 Fastify `app.addHook('onClose')` 清 interval（`AppRuntime` 无生命周期概念——r3-l1 修正）」 | `app.ts:18-26` `AppRuntime` 确为纯数据类型（无 start/stop/close）✓，`buildServer:87-119` 构造 Dispatcher、`buildApp:47` 构建 Fastify app，onClose 通道可行 ✓ | **已闭合**（残留 `D3` 措辞见 L1） |
| L2 回调丢 this / 形参不一致 | low | :40 接线改 `service.onInflightReleased = (id) => dispatcher.releaseAndRecheck(id)`（箭头包裹防 this 丢失） | 箭头包裹确已防 `this` 丢失 ✓；但 r3-l2 要求的「统一签名（无参或可选参二选一）」未落 → 见 L3 | **部分闭合** |
| L3 取消清空 queued | low | :38 ⑤ 补「**任何离开 SPEC_READY 的转移（DISPATCHED 放行成功 / CANCELLED 取消）清空 queued 两字段**」 | 对齐 spec 规则 3（`spec.md:61`「成功放行（DISPATCHED）或取消（CANCELLED）时清空」）✓ | **已闭合** |
| L4 tick 每单异常隔离 | low | :22 技术方案 6 补「5s tick 扫到期单（**每单 try/catch 隔离，单单失败不影响他单，异常 log**）」 | tick 轮已写死隔离 ✓；但 r3-l4 明示「**tick 与 `releaseAndRecheck` 均按单** try/catch」——唤醒轮未写 → 见 L4 | **部分闭合** |
| L5 helpers config 三键 + seam 术语 | low | :45 helpers 行补「config 三键透传（maxConcurrentPerRepo/maxRetries/retryBackoffSec）」（r3-l5） | config 三键注入 ✓（`helpers.ts:73-77`/`:164-168` 确为 AppConfig 内联字面量，扩字段必改）；但 seam 术语漂移未对齐 → 见 L2 | **部分闭合** |

## 发现的问题

### low

1. **`D3` 措辞与 `app.ts` 行自相矛盾（编辑残留）** — 严重程度：low
   - 位置：impl:79（D3「tick=dispatcher 内 setInterval（opts：tickIntervalMs/now），**AppRuntime 挂载/清除**」）vs impl:40（「…`app.addHook('onClose')` 清 interval（**AppRuntime 无生命周期概念**——r3-l1 修正）」）
   - 影响：同一文档内对同一挂载/清理通道给出相反表述；r3-l1 已在 app.ts 行修正，`D3` 未同步，Builder 若以 D3 为准会去找不存在的 `AppRuntime` 生命周期钩子（轻微返工风险）。
   - 建议：`D3` 尾句改为「挂载于 `buildServer` 构造 Dispatcher 处；清理挂 Fastify `onClose` 钩子」（与 app.ts 行一致）。

2. **seam 术语未对齐：`DispatcherOptions` 实为 `DispatcherDeps`；「`app.ts` `AppRuntime` 构造」实为 `RuntimeOptions`→`buildServer`；`app.ts` 行未列 `RuntimeOptions` 扩字段** — 严重程度：low
   - 位置：impl:24（「`DispatcherOptions`（现有构造 opts）扩 `tickIntervalMs?/now?`；通路：测试 → `test/helpers.ts` → `app.ts` **AppRuntime 构造** → Dispatcher」）、impl:45（「工厂扩 `DispatcherOptions` 透传」）、impl:40（`app.ts` 行未提 `RuntimeOptions` 扩 `tickIntervalMs?/now?`）
   - 代码事实：`dispatcher.ts:20` 类型名为 `DispatcherDeps`（无 `DispatcherOptions`）；`app.ts:18-26` `AppRuntime` 为数据类型，Dispatcher 构造与 op ts 透传在 `buildServer`（`app.ts:87-119`），入参类型为 `RuntimeOptions`（`app.ts:29-40`）。
   - 影响：类型名指向不存在符号；「`AppRuntime` 构造」指错层次——Builder 按字面找不到 `RuntimeOptions` 扩字段的改动位，seam 三跳通路（测试→helpers→buildServer→Dispatcher）描述含混。
   - 建议：全篇 `DispatcherOptions`→`DispatcherDeps`；「`app.ts` `AppRuntime` 构造」→「`app.ts` `RuntimeOptions`（`buildServer` 透传）」；`app.ts` 行补「`RuntimeOptions` 扩 `tickIntervalMs?/now?` 并透传 Dispatcher」。

3. **`releaseAndRecheck` 接线传实参 vs 实现署名无参——r3-l2「统一签名」未落** — 严重程度：low
   - 位置：impl:40（`dispatcher.releaseAndRecheck(id)`）vs impl:18/39（`releaseAndRecheck()` 单一实现 / `releaseAndRecheck()`：FIFO…）；回调契约 impl:20 为 `(ticketId) => void`
   - 影响：r3-l2 明确要求「技术方案 5 统一签名（无参或可选参二选一）」。若 Builder 按 impl:18/39 定义 `releaseAndRecheck(): void` 而 app.ts 行按字面传 `id`，TS 直接调用多余实参将报 TS2554（编译期暴露，非运行期），阻断构建。
   - 建议：impl:18/39 统一写 `releaseAndRecheck(_ticketId?: number)`（参数仅作来源标记），或 app.ts 接线去掉实参 `() => dispatcher.releaseAndRecheck()`。

4. **唤醒轮 `releaseAndRecheck` 的每单 try/catch 隔离未明写（r3-l4 仅覆盖 tick）** — 严重程度：low
   - 位置：impl:22（技术方案 6 仅给 5s tick 写「每单 try/catch 隔离」）；impl:18/39（`releaseAndRecheck()` FIFO 整轮，无隔离声明）
   - 代码事实：`ticket-service.ts:434-436`（`to==='DISPATCHED'` 先过 `assertDependenciesDone`，可抛 `BLOCKED_BY_PENDING`）；`dispatcher.ts:425-448` `onTicketSettled` 对下游单逐条 try/catch 为既有惯例。
   - 影响：排队单在排队期依赖被破坏时，唤醒轮 `transition(...,'DISPATCHED')` 抛异常会中断整轮 FIFO，本轮其余排队单顺延到下一个 5s tick 才被处理（自愈但非零延迟）；r3-l4 建议的「tick 与 releaseAndRecheck 均按单隔离」只落一半。
   - 建议：技术方案 5 的 `releaseAndRecheck` 条目补一句「按单 try/catch，失败 `console.error` 留痕并继续下一单（对齐 `onTicketSettled` 既有形态）」。

## spec→impl 覆盖核对（本轮变化行）

| 基准项 | impl 落点 | 判定 |
|---|---|---|
| 验收 5 重试自愈（60/120/240 → 升级） | 技术方案 6 先判后等 + D6 + 测试行 60-120-240 | ✅（r3-M1 闭合） |
| 规则 9/10 契约与 UI（plannedFiles 录入） | 契约冻结 + `TransitionActions:88`/`WorkbenchPage:80` 录入 + `SpecCard` 只读 | ✅（r3-M2 闭合） |
| 规则 3 排队生命周期（清空时机） | ⑤ 任何离开 SPEC_READY 清空 queued | ✅（r3-l3 闭合） |
| 规则 5 唤醒触发面（单入口收敛） | 八直调 + 两 user 回调 + 启动扫描（r3 穷举裁定完备） | ✅（残余签名口径见 L3） |
| 验收 4 饥饿免疫四路径 | 八直调 + 测试行四路径（超时/崩溃/preSpawnFail/卡点 BLOCKED） | ✅（唤醒轮隔离残留见 L4） |
| 验收 3 闸门 FIFO | ① 早绑定 + ⑧ FIFO + helpers config 三键注入 | ✅（术语残留见 L2） |
| 验收 7 重启恢复 | ⑥ `recoverOnStartup`（RETRY_WAIT 到期即恢复 + 排队重校验）；`index.ts:27` 早于 `listen` | ✅ |
| 验收 9 回归口径 | D7/D8 + 风险表 | ✅ |

## 附加终审点结论

### 1. 挂载清单行号复核（v4 微调后）

v4 技术方案 5（impl:19）把 r3 核定的行号写作约值：超时 `:222`（实 `:223`）/崩溃 `:231`（实 `:235`）/卡点 BLOCKED `:270-294`（覆盖 `:282`）/preSpawnFail→CANCELLED `:315`（实 `:316`）/preSpawnFail→FAILED `:323` ✓/abort `:361` ✓。经 `dispatcher.ts` 15 处 `transition` 调用点（`179/223/235/265/282/301/316/323/361/364/368/399/438/463/470`）复核，**归属集合与 r3 裁定完全一致、无遗漏无新增**；偏差均在「约」前缀免责范围内（≤4 行），不影响指向唯一调用点。

### 2. 契约冻结 vs spec 规则 8/9 复核

`FILE_SET_CONFLICT`（422，`details` 双单号+相交文件）/`queuedReason: 'GATE_QUEUED'|'FILE_CONFLICT'|null`/`queuedAt`/`retryCount`/`retryAt`/`plannedFiles: string[]|null`/`{specContent, plannedFiles?}` 与 spec 规则 8/9、范围 26/28 逐字段吻合；放行响应保持 `{ticket}`（`routes/tickets.ts:140`）不变。✓（与 r3 一致，无回归）

### 3. 块 1 / 块 2 文件集不相交终核

块 1 = `apps/server/{src,drizzle,test}/**` + `config.yaml`；块 2 = `apps/web/src/**`，**仍无交集**。新增件归属正确：`test/{api-s3,file-set}.test.ts` → 块 1；`components/QueuedTag.tsx` → 块 2；两处 `types.ts` 路径不同各归其块。`BlockedResolutionCard.tsx`（块 2 复用既有件）、`utils/hooks.ts` 的 `useNow` 均真实存在（`WorkbenchPage:13/342`、`TicketDetailPage:172`、`hooks.ts:25`），无幽灵引用。

### 4. 技术决策速评（D1-D9）

D1/D2/D4/D5/D6/D7/D8/D9 均 ✅；D3 ⚠（seam 声明正确，挂载/清除措辞残留见 L1）。

## 观测（不计分）

1. **spec 规则 6「retry_count 达 maxRetries → 升级」措辞与 impl 计数值语义差 1**：impl 计数值首次=1、升级在 `count > maxRetries`（默认 3 ⇒ count=4，即三次 retry 后）；spec 规则 6 字面「达 maxRetries」若按同口径直达 count=3 则只剩两次 retry。impl 口径与验收 5（60/120/240 三档）+ 测试行自洽，且为 r3-M1 明示采纳的选项②，**非 impl 缺陷**；建议 spec 后续复评把规则 6 措辞改为「重试次数达 maxRetries」以消歧。
2. **tick 定时器在「不调 `app.close()` 的测试上下文」的泄漏面**：`app.addHook('onClose')` 覆盖生产与显式关闭路径；`helpers.ts` 现无 teardown（仅 `workspace-contract.test.ts:237` 用 `.close()`）。建议 impl/实现约定「测试经 helpers 显式注入 `tickIntervalMs`（如 0=不挂载）」，否则默认 5s 间隔会 ref 住用例事件循环。属实现期注意项，不影响任务书正确性。
3. **SPEC_READY→CANCELLED 释放占用集无触发点**（规格层，与 r3 观测 1 同）：规则 5 触发面不含 SPEC_READY 出边，impl 忠实于 spec，建议 spec 后续复评。
4. **`onTicketSettled` 自动放行返回排队单的空转**（与 r3 观测 2 同）：建议实现按 `transition` 返回 status 判是否 spawn。
5. **`routes/types.ts` 为纯 re-export**（与 r3 观测 4 同）：:44 的字段增量实落 `ticket-service.ts` 域类型，:38 ⑦ 已覆盖，属表述冗余。

## 结论

# PASS

状态：IMPL_REVIEWING → IMPL_APPROVED

一句话理由：r3 两项 medium（D6 退避 240 不可达、plannedFiles 录入错位）经代码事实核对均**实质闭合**，三条 low 主项落地、全文无编辑残留与块间冲突，挂载清单仍完备；仅余 4 项 low（D3 措辞残留 / seam 术语 `DispatcherOptions`↔`DispatcherDeps` / `releaseAndRecheck` 签名口径 / 唤醒轮每单隔离），无 medium+，按本仓惯例予 PASS，建议 Builder 编码时按 L1-L4 顺手收敛（皆为一行级措辞）。
