# 质量门审查报告: atd-s2b1-humanthink (Revision 3)

> 终检判定：**PASS（92/100）**。r2 的唯一 critical（镜像 `type='message'` 用户消息行落 `default` 丢弃 → 重开会话用户自己的话整体消失）**已闭合**，h4 的测试面缺口**已闭合**；本轮修复形态与 r2 修复清单逐条对得上，快去重边界核到「DB 先查后插 + 视图 Set 双层、顺序无关」；独立复跑 **218+16+9 全绿 + web build 通过**。余项 4 条 low（3 条为 r2 已判不阻塞的遗留项、1 条为本轮新引入的错误路径 UX 残留），无 medium+。

- 类型：Story 质量门全面审查（S-S9 质量门 · 第三轮 / r3，修复重递）
- 对象：worktree `/home/starlex/project/ATD-s2b1-server`，分支 `dev/feat/atd-s2b1-humanthink` @ **`a11e588`**
- commit 范围：本轮修复 `git diff 5cd21f5..a11e588` = **5 文件 +56 / -13**（routes 1/api-s2b1.test 1/serve-manager.test 27/web types 16/HumanThinkPage 22）；全链 `8aa5e62`（基线）→ `fa21077`（块 1）→ `f59b68d`（块 2）→ `9e1e879`（合流）→ `41882e6`（对账三补）→ `5cd21f5`（r1 修复）→ **`a11e588`（本修复）** = 37 文件 +5363/-13
- 事实源：spec v7（业务语言版，验收按业务语义逐条核）/ impl v2.1 / **契约唯一事实源 `probe-report.md`（含 0 号补录）** / 项目 `AGENTS.md` / r1+r2 报告
- 状态校验：实测 `.stage` = `QUALITY_GATE`（与质量门「审查前状态」一致）→ 允许落定
- 独立复跑后 `git status --porcelain` 为空（未改一文件）
- 日期：2026-09-26

## 总体评价

**通过**。本轮是「单点补齐」型修复，两点均在位且经行级核对：

1. **r2 critical 闭合**——`toChatItems` 补 `case 'message'`（按 `ev.role` 分流 + `messageId` 去重），用户气泡改由 **SSE 镜像行**承载（本地伪回显整段删除），prompt 响应透出 `messageId`，类型值域补 `'message'`/delta 改短名/相悖注释修正。**关键前提我逐环验过**：`messageId` 在镜像拍平（`{...r.event, …}`）与 live 帧（`{...frame.event, …}`）后**均可达** `toChatItems`；去重为**双层且顺序无关**（DB 层 `(type='message', payload.messageId)` 先查后插 → 至多一行；视图层 `seenMessageIds` 二次防御）；删本地回显后的可见性由 **attach 的 `seq>after` 回放**（重连 2s、游标=最后 durable seq）+ 详情重载兜底，与验收 2「不丢」自洽。
2. **h4 测试面闭合**——补「pid 空 + 异步 `'error'`」用例（`serve-manager.test.ts:123-149`），用例有效性真实（EventEmitter 无 `'error'` 监听时 emit 抛未捕获异常 → 若回退修复，测试进程即崩）；用例数 5→6，运行日志实见「未获得 pid」与「子进程 error 事件」两条并续走退避重试。

快扫 `5cd21f5..a11e588` 全 diff：**未发现 medium+ 新引入问题**；两条窄窗/接线类风险按 r1 O9 同口径记档为观察项（不给分）。

## 质量评分

**92 / 100**

| 严重度 | 条数 | 单扣 | 小计 |
|---|---|---|---|
| critical | 0 | -25 | 0 |
| high | 0 | -12 | 0 |
| medium | 0 | -5 | 0 |
| low | 4 | -2 | -8 |

扣分项：问题 1（本轮新引入：prompt 失败路径用户输入丢失 + 3 处陈旧注释）、问题 2（`lastActiveAt` 手抄缺）、3（`renderServeCommand` 未复用）、4（冒烟腿⑤ 进程清理与真实库副作用）——后三条为 r2 已判不阻塞的遗留项，本轮确认 Issue 化归属。

## fence 结果

Checker 在冻结树（`a11e588`，`git status` 干净）独立复跑：

- `pnpm -F @atd/server test`：**218 用例（17 文件）**，218 通过，0 失败，0 跳过（7.49s）——**217 → 218，+1 即 serve-manager 新用例**（`serve-manager.test.ts` 5 → 6 例），与 h4 测试面闭合一一对应
- `pnpm -F @atd/worker-core test`：16 用例（2 文件），16 通过（0.40s）
- `pnpm -F @atd/worker-opencode test`：9 用例（1 文件），9 通过（0.36s）
- `pnpm -F @atd/worker-core exec tsc --noEmit` / `@atd/worker-opencode exec tsc --noEmit` / `@atd/server exec tsc --noEmit`：三者静默通过（exit 0）
- `pnpm -F @atd/web build`（`tsc --noEmit && vite build`）：成功（3069 modules；`index-BesOBMvk.js` 1.205MB / gzip 379KB，3.54s；chunk 体积告警为存量现象）
- E2E 测试：无（本项目无 E2E 基建，与 S1/S2a/S2w1/S3 同口径）
- 合计：**243 用例，243 通过，0 失败，0 跳过**

> 复跑口径：`bash .specpipe/fence.sh` 整体脚本被本会话权限引擎拒绝（`bash` 不在白名单），按其 `:6-12` 条目**分段等价复跑**（三包 tsc + 三包 test + web build）；`:5` 的 `pnpm install --frozen-lockfile` 未跑（依赖树未动、无 lock 变更）。
>
> **冒烟（`scripts/smoke-humanthink.sh`）本轮未复跑**，理由同 r2：非 fence 项，需真 serve + LLM 轮次 + 起第二个真 ATD；腿⑤ 会以**真实 dataDir 库**启动 ATD（migration + `recoverOnStartup`）且脚本进程清理不完整（问题 4），不宜在用户库上二次施压。采信：调度者 SMOKE 五腿 PASS 记录 + 真机留存帧 `/tmp/opencode/ht-abs-debug/`；本轮修复**未触冒烟脚本与 serve spawn 链路**（diff 5 文件无 scripts/、无 serve-manager.ts），冒烟结论不因本轮失效。

## r2 → 修复闭合表（逐项裁定）

| # | r2 判定 | 修复落点 | 证据 | 裁定 |
|---|---|---|---|---|
| **critical** 镜像 `type='message'` 用户消息不渲染 → 验收 2 不达 | critical | `HumanThinkPage.tsx:93-108`（`case 'message'` + role 分流 + `seenMessageIds` 去重）、删本地回显 `:445-458`、值域补型 `types.ts:373-395/409-412`、prompt 响应透出 `routes.ts:245` + `types.ts:357-362` + 用例强化 `api-s2b1.test.ts:201/210` | 见下「critical 闭合四环核验」 | **已闭合** |
| **h4** 缺「pid 空 + 异步 error」用例 | low | `serve-manager.test.ts:123-149`（新用例，1 例） | 用例有效性成立（见「h4 测试面核验」）；用例数 5→6、总数 217→218；运行日志实见两条日志行 | **已闭合** |
| r2 问题 2 手抄缺 `lastActiveAt` | low | 未落 | `types.ts:292-304` 仍 7 字段 | **未闭合 → 保持 low**，Issue 化归属见问题 2 |
| r2 问题 3 h4 测试面 | low | 已落 | 同上 | **闭合** |
| r2 问题 4 `renderServeCommand` 未复用 | low | 未落（`app.ts` 本轮未动） | — | **未闭合 → 保持 low**，见问题 3 |
| r2 问题 5 冒烟腿⑤ 进程清理/真实库副作用 | low | 未落（脚本未动） | — | **未闭合 → 保持 low**，见问题 4 |
| r2 清单 #3「web 侧锁定 message 型渲染用例」 | 建议 | 未落（项目无前端测试基建，`toChatItems` 未导出） | web 无测试文件；契约注释已落在 `:94`/`types.ts:374` | 按 r2 声明的可选项口径**不另计**（存量口径：web 无自动化测试面） |

### critical 闭合四环核验（行级锚定）

1. **渲染分支与 role 分流** —— `HumanThinkPage.tsx:93-108`：`case 'message'` 就位；`role: ev.role === 'assistant' ? 'assistant' : 'user'`（缺省=user，与 `events.ts:545` 的 `role:'user'` 字面量一致）；`text: ev.text ?? ''`。原 `USER_PROMPT` 伪型与本地回显常量已整段删除（web 全目录 grep `user.prompt|USER_PROMPT` = **0 命中**）。
2. **`messageId` 在两种到达形态下均可达** —— 镜像行：`routes.ts:200-206` 序列化 `{seq, serveSeq, type, event: JSON.parse(payload)}`，payload 即 `events.ts:545` 的 `{type:'message', messageId, role, text}` → 拍平 `{...r.event, seq, timestamp}`（`HumanThinkPage.tsx:289`）**保留 messageId**；live 帧：`events.ts:548` `forward(sessionId, {seq, event:{type:'message', messageId, role, text}})` → `HumanThinkPage.tsx:344` `{...frame.event, seq}` **保留 messageId**。与 web 手抄 `HumanThinkEvent.messageId?: string`（`types.ts:411-412`）对齐。
3. **去重边界（本轮重点核）** ——
   - **DB 层（主）**：`insertOwnRow` 的 dedupe 分支（`events.ts:340-355`）以 `type='message'` + `json_extract(payload,'$.messageId')=value` **先查后插**；两条写入路径键型一致——`insertUserMessage:541-549`（prompt 即时落行，`{key:'messageId'}`）与 `reconcileMessage:449-454`（对账兜底，`{key:'messageId', value: msg.id}`）→ **同一 messageId 至多一行，与到达顺序无关**（先到者落行、后到者返回 null 且不 forward）。
   - **视图层（次）**：`seenMessageIds`（`:90-99`）按 `messageId` 去重、`mid != null` 才入集 → 即便 DB 层因 id 口径漂移落下两行，视图仍只渲染一条；`seq` 相同者另有 `seenSeqRef` 拦截（`:341`），故「镜像先到 + SSE 重放」「SSE 先到 + 详情重载」两序均单条。
   - **`messageId` 缺失 fallback 键**：`mid == null` 时退 `m-${msgId++}`（`:102`）——仅防御性路径（生产落行两路恒带 id），无 id 即无可比对对象，退化为顺序键是唯一可行解，可接受。
   - **prompt 响应 id 与对账 id 同为 serve 用户消息 id**：`session-facade.ts:77-85` 取 `data.id`，`reconcileMessage` 取列表项 `msg.id`，`api-s2b1.test.ts:210` 以 `/^msg_test_/` 锁定同族；`fake-serve.ts:133/135` 证明两条路径同 id 源。
4. **删本地回显后的可见性口径（与验收 2 自洽）** —— 用户消息唯一来源=镜像行，三条兜底链完整：① live：prompt 端点内 `insertUserMessage` 先落行再 forward（`routes.ts:244-246`，转发早于响应返回）；② 断流窗口：`attach(id, after, send)` 注册监听后**同步回放 `seq > after` 的行**（`events.ts:558-579`），web 重连以「最后 durable seq」为 `after`（`humanthink.ts:161/183/193`，2s 重建）→ 断连期间落的行重连即补齐；③ 重开/切换：`loadDetail → resetFromMirror`（`:288-303`）整量替换，已删会话只读详情走同一入口 → **用户侧历史可见**。结论：失联窗口「延迟数秒可见」而非「丢失」，与验收 2（打开内容完整、不丢不重）自洽；正常路径无重复（本地回显已删，无双写源）。

### h4 测试面核验（`serve-manager.test.ts:123-149`）

- 被测代码形态：`serve-manager.ts:120-123` 在 **pid 检查（`:124`）之前**无条件挂 `child.on('error', …)`，故 pid 空分支（`:124-127` `return false`）不再留零监听 ChildProcess；既有 `:139-143` 的 `once('error')→onCrashed` 仅 pid 非空分支注册，二者并存无害（前者仅日志）。
- 用例构造：`new EventEmitter() as ChildProcess` + `pid: undefined` + `queueMicrotask(() => bad.emit('error', new Error('spawn opencode ENOENT')))`，断言 `mgr.start()` resolves `'degraded'`、`spawned >= 1`。
- **验证逻辑成立**：Node 的 `EventEmitter` 在**无 `'error'` 监听**时 emit `'error'` 会抛出未捕获异常（vitest 报 unhandled error 并使文件失败）→ 若回退 `:120-123` 的修复，该用例必然转红，属**真护栏**而非同义反复。实证：复跑日志实见 `serve spawn 未获得 pid…` 与 `serve 子进程 error 事件：spawn opencode ENOENT` 两行，随后续走退避重试（`第 1 次重启`），即「吞掉异步错误 → 走失败/重启链」全路径被覆盖。

## 发现的问题

### 1. 本地回显移除后：prompt 失败路径用户输入丢失 + 3 处陈旧注释 —— 严重程度：low

- 位置与事实：
  - `HumanThinkPage.tsx:445-458`：`setInput('')`（`:449`）在 `await promptHtSession` 之前，而本地回显已随本轮修复删除 → 请求失败（degraded 503 / 网络错误等非 `SESSION_TERMINATED` 分支）时，**输入框已清空、聊天区无回显**，用户敲的字两头都不在，只能重打。
  - 同一处 `:454` 注释「其余失败 toast 已弹；**回显保留由用户重发**」与实现相悖（已无回显）。
  - `types.ts:360`「SSE 镜像行按此幂等；**回显去重依据**」、`:411`「**回显去重依据**」：均指向已删除的本地回显；`messageId` 现为契约完备性字段（web 无消费点）。
- 影响：仅**错误路径 UX**（无服务端数据丢失、无重复渲染；正常成功路径与验收 1/2 不受影响）。
- 建议（数行）：失败分支 `setInput(text)` 回填输入框（最省），或保留一枚带失败标记的纯本地 pending 气泡；同步修正 3 处注释。

### 2. 手抄残留：`HumanThinkSession` 仍缺 `lastActiveAt` —— 严重程度：low（r2 问题 2 未落，Issue 化）

- `types.ts:292-304` 仍 7 字段；UI 未消费该字段（列表排序由服务端 `lastActiveAt desc` 承担），无害。**归属：转后续 Issue「web 手抄补齐」**（与 r2 清单 #3 的契约锁定建议合并处理）。

### 3. `renderServeCommand` 导出未复用 —— 严重程度：low（r2 问题 4 未落，Issue 化）

- `packages/worker-core/src/profile.ts` 的导出仅测试消费；`app.ts` 仍内联 `trim().split(/\s+/)` 渲染（`{port}` 替换在 `serve-manager.ts:104`），同一语义两处实现。**归属：转后续 Issue（1 行级清理）**。

### 4. 冒烟腿⑤（`smoke-humanthink.sh:209-221`）进程清理与真实库副作用 —— 严重程度：low（r2 问题 5 未落，Issue 化）

- `ATD_PID` 为子 shell，`kill "$ATD_PID"` 不保证终止 `pnpm`/node 与 detached 的 serve 进程组；`index.ts` 无 signal 监听 → `onClose` 可能不执行。腿⑤ 另以**真实 dataDir 库**启动 ATD（migration + `recoverOnStartup`）。**归属：与 r1 O3（对账翻页腿未覆盖）合批转「冒烟脚本维护」Issue**，建议 `setsid`/`kill -- -$PID` + 脚本头记档真实库副作用。

## 非扣分观察项（新）

- **O10（新）对账 assistant 兜底行与 `text.ended` 行的跨型重复渲染竞态**：`events.ts:173` 每次流连接即 `reconcileAll()`；`reconcileMessage:431-454` 仅以「`text.ended` 行是否已存在」为跳过判据，**无消息完成态判据** → 若全局流异常中断（含 serve 重启）恰好发生在助手生成中途，重连时对账先落 `message(role=assistant, 部分文本)` 行，随后 live `session.text.ended` 再落一行，二者**类型不同**（`messageId` vs `messageID`）、web 无跨型去重 → 同一条助手回复出现两个气泡且**持久**（两行皆 durable，刷新不消）。触发面=外因流断 + 生成中，正常路径（生成完成后重连）由存在性判据拦住。按 r1 O9「去重缺口类风险、窄窗」同口径**不扣分**；建议护栏（二者取一）：web 侧 `HumanThinkEvent` 补 `messageID` 并跨型去重，或 reconcile 端跳过未完成消息。**转 Issue**。
- **O11（新）对账文本源未接线详情端点**：`probe-report.md:30`「列表不含 payload（`/message/:messageID` 详情）」，而 `reconcileMessage:448` 直接用**列表项**的 `msg.text`/`assistantText(msg)`；`session-facade.ts:128` 的 `getMessage`（详情端点）**全仓无调用点**（死方法）；`fake-serve.ts:135` 的列表自带 `text` → 测试面无法判别。若真机列表确无文本，则 reconcile 的 **assistant 兜底行**为空文本（用户侧不受影响——`insertUserMessage` 用请求文本）。**建议一次真机核验**（`GET /api/session/:id/message` 看条目是否带 `text`/`content`）并落记档；结论未定前不计分（不阻塞交付）。
- **O12（cosmetic）key 命名空间**：`m-${mid}`（`HumanThinkPage.tsx:102`）与 `m-${msgId++}`（`:102/111/119/128`）同前缀；现网/假 serve id 恒为 `msg_*`（`fake-serve.ts:133`），无碰撞；建议前缀区分（`mid-` vs `m-`）防未来 id 形态变化。
- **r1 O1-O9**：结论沿用（本轮 diff 未触及相关面）；其中 O2（`onReady` seam 死置注释）、O3（对账翻页腿）保持「转后续 Issue」归属。

## 修复是否引入新问题（快扫 `5cd21f5..a11e588` 全 diff）

| 面 | 结论 |
|---|---|
| 镜像/SSE 两形态 `messageId` 可达性 | **正确**（见「critical 闭合四环」第 2 环）；手抄类型同名字段一致 |
| 去重顺序无关性 | **成立**（DB 先查后插为主、视图 Set 为辅；同 seq 另由 `seenSeqRef` 拦截） |
| `messageId` 缺失 fallback 键 | 可接受（防御路径；生产两路恒带 id）；命名空间见 O12 |
| 删本地回显 | **无双写源**、无重复渲染；失败路径副作用见问题 1 |
| `route` 响应形状变更（`{admitted}` → `{admitted, messageId}`） | 属**向后兼容的加字段**；web client 类型已同步（`types.ts:357-362`）；用例由 `toEqual({admitted:true})` → `toEqual({admitted:true, messageId:'msg_test_1'})` 属**断言强化**（非法/多余字段仍会被抓），未放松 |
| 类型值域改短名（`session.*.delta` → `*.delta`） | 与 server 产物（`events.ts:606/610`）一致；无残留消费点（web grep 0 命中） |
| assistant 兜底行渲染 | 本轮**首次让对账行可见** → 收益：错过 live `text.ended` 时助手文本可由对账补齐（规则 6 语义增强）；残留竞态见 O10 |
| 测试面 | +1 用例（218），无既有用例删改（`api-s2b1.test.ts` 仅强化断言） |

## 验收标准 1-7 逐条核验（r3 状态）

| # | 验收（用户可验证） | r2 | r3 状态 |
|---|---|---|---|
| 1 | 会聊（逐字出现/思考折叠/工具卡） | ✓ | ✓（未动；delta 短名与 server 产物一致） |
| 2 | 不丢话（内容完整、重启不丢不重） | ✗（用户消息整体消失） | **✓ 判定翻转**：用户/助手两侧均有镜像行渲染分支；用户侧由 prompt 落行（带文本）+ SSE 转发 + 重连回放 + 详情重载四路保障；重开（含已删只读详情）内容完整；同 `messageId` 双层去重 → 不重 |
| 3 | 不干扰自用 opencode | ✓ | ✓（未动） |
| 4 | 有边界（视野外拒/敏感请示/视野内读） | ✓（O1 另获真机证据） | ✓（未动） |
| 5 | 可打断 | ✓ | ✓（未动） |
| 6 | 不泄密 | ✓ | ✓（未动） |
| 7 | 不伤旧（全量测试绿） | ✓ | ✓（218+16+9 + 三包 tsc + web build 全绿；复跑前后 `git status` 空） |
| — | 规则 5「历史可查」 | ✗ 消费面 | **✓ 消费面翻转**：已删会话只读详情经 `resetFromMirror` 渲染 `message` 行 → 用户侧历史可见 |

## commit 信息核验

- `a11e588`：单行主题，中文、`fix:` 前缀，主题写清「r2 critical 修复 + 内容项」（message 型渲染/role 分流/messageId 去重/删伪回显/响应透出/值域对齐/h4 用例），与链上 `5cd21f5`/`41882e6` 风格一致；无 body、无冗余模板。✓

## 文档归档与 AGENTS.md

- spec v7 / impl v2.1 / probe-report 在 worktree 与主仓 `.specpipe/plans/atd-s2b1-humanthink/` 齐备（含 spec r1-r5、impl r1-r3 审查链）✓
- **r1 末节 7 条 AGENTS.md 建议仍有效、无需增删**（本轮 diff 未产生新的坑位条目）：①结构树补 humanthink 五模块/0005/生成配置/冒烟/config `humanthinkPort`；②新增 HumanThink 速查（9 端点、双通道与幂等键、恢复对账、软删三分、once-reject、三档五规则与 catch-all ask 硬编码）；③视野=主仓+readable、名单运行期不变；④spawn 坑位两条（`env` 合并 + 失败路径 `'error'` 监听）；⑤**web 手抄契约须与 server 类型逐字段比对**（本 Story 三处漂移的教训：详情 events 包装形状 / live delta 名 / 镜像值域 `message`）；⑥`bash scripts/smoke-humanthink.sh`（手动、不进 fence）；⑦serve 退避 3 次转 degraded 需重启 ATD。
  - 建议第 ⑤ 条**追加半句**（本轮补强）：镜像 `message` 行是用户消息主源，且与 `text.ended` 之间**无跨型去重**（O10）——手抄比对时须一并核对「同一逻辑消息的多型落行是否会双渲染」。
- 归属：交付后动作，由调度者随 PASS 收尾执行（本门不扣分，沿用 S2w1/S3 终检先例）。

## 状态落定

- 审查前实测 `.stage` = `QUALITY_GATE`（与质量门审查前状态一致）→ 本报告结论 **PASS**，落定目标态 **`DONE`**（质量门 PASS → DONE；终检双 PASS 汇合由调度者执行）。
- 若状态机拒绝该边或要求由调度者落定，则转调度者；本报告技术结论不受影响。

## 结论

# PASS

状态：QUALITY_GATE → DONE

一句话理由：r2 的唯一 critical（web 丢弃 `type='message'` 用户消息行）**已按建议单点闭合**——`toChatItems` 补 `case 'message'` 按 role 分流、`messageId` 在镜像拍平与 live 帧后均可达、去重为「DB 先查后插 + 视图 Set」双层且顺序无关、删本地回显后由「prompt 落行先于响应 + attach 的 `seq>after` 回放（2s 重连）+ 详情重载」三路保可见，已删会话只读详情同入口 → 验收 2「不丢/不重」与规则 5「历史可查」的消费面双双翻转；h4 测试面补上「pid 空 + 异步 `'error'`」真护栏用例（217→218）；独立复跑 **218+16+9 + 三包 tsc + web build 全绿**、复跑前后 `git status` 空。余项 4 条 low（3 条为 r2 已判不阻塞的遗留项转后续 Issue，1 条为本轮新引入的 prompt 失败路径输入丢失 + 陈旧注释），无 medium+ —— **92/100 PASS**。
