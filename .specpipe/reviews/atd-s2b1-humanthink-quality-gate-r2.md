# 质量门审查报告: atd-s2b1-humanthink (Revision 2)

> 终检判定：**REJECT（67/100）**。r1 的 3 critical + 1 high 中 **c1/c2/h4 全闭、c3 部分闭合**——信封解包（详情形状）已按 `routes.ts` 序列化字段逐字段对齐，助手历史「空气泡」与审批卡幽灵/错关两条症状消失；但 r1 c3 的第三条症状与 r1 修复清单第 4 项明列的「**补 `message` 型与 role 处理**」**未落**：镜像里用户消息行的 `type='message'`（服务端 `api-s2b1.test.ts:179` 断言其存在）落到 web `toChatItems` 的 `default: break`，**用户自己的话在重开会话后整体消失** → 验收 2「昨天的会话今天打开内容完整」仍不达。
>
> 修复面**极小且单点**（web 一处 `case 'message'` + 类型值域 3 行），不建议回退 spec/impl。

- 类型：Story 质量门全面审查（S-S9 质量门 · 第二轮 / r2，修复重递）
- 对象：worktree `/home/starlex/project/ATD-s2b1-server`，分支 `dev/feat/atd-s2b1-humanthink` @ `5cd21f5`
- commit 范围：本轮修复 `git diff 41882e6..5cd21f5` = **5 文件 +92 / -6**（serve-manager 8/serve-manager.test 2/web types 11/HumanThinkPage 9/smoke 68）；全量链 `8aa5e62`（基线）→ `fa21077`（块 1）→ `f59b68d`（块 2）→ `9e1e879`（合流）→ `41882e6`（对账三补）→ `5cd21f5`（本修复）
- 事实源：spec v7（业务语言版，验收按业务语义逐条核）/ impl v2.1 / **契约唯一事实源 `probe-report.md`（含 0 号补录）** / 项目 `AGENTS.md` / r1 报告
- 状态校验：实测 `.stage` = `QUALITY_GATE`（与质量门「审查前状态」一致；`.stage-history` 末行 = 调度者 00:41:20 `WORKING→QUALITY_GATE`）→ 允许落定
- 独立复跑后 `git status --porcelain` 为空（未改一文件）
- 日期：2026-09-26

## 总体评价

**不通过**。本轮修复的代码形态与 r1 诊断**逐条对得上**，且修复质量高：

1. **c1 闭合**——`serve-manager.ts:106-111` 改为 `{...process.env, OPENCODE_SERVER_PASSWORD, OPENCODE_CONFIG_DIR}`（键序正确：两个自有键在后、必然覆盖继承面），与既有惯例 `execution.ts` 合并口径一致；单测新增 `expect(opts.env.PATH).toBe(process.env.PATH)`（`serve-manager.test.ts:33`）把 r1 指出的「fake 已记录 `lastSpawnEnv` 却未断言」这一盲区堵上；冒烟新增腿⑤把「ServeManager 真实 spawn」纳入真机证据面（原先冒烟自行 spawn serve，绕过托管链路——正是假绿根源）。
2. **c2 闭合**——`HumanThinkPage.tsx:97/128` 改判短名，与 server `toHumanThinkEvent` 产物（`events.ts:607/611` 的 `text.delta`/`reasoning.delta`）两端一致；全 web 目录已无 `session.*.delta` 消费点（仅剩类型声明，见问题 2）。
3. **h4 闭合**——`child.on('error')` 前移至 pid 检查之前（`serve-manager.ts:120-123`），pid 空分支不再留零监听 ChildProcess；与既有 `:139-143` 的 `once('error')→onCrashed` 并存无害（前者日志、后者崩链）。
4. **c3 部分闭合**——`web types.ts:323-330` 新增 `HumanThinkMirrorRow`（`seq/serveSeq/type/event/createdAt` 与 `routes.ts:31-38/200-206` 序列化**逐字段**一致），`resetFromMirror` 拍平成 `{...r.event, seq, timestamp: r.createdAt}`（`HumanThinkPage.tsx:275-284`），与 server 回放帧 `{seq, event:{...payload, timestamp: createdAt}}`（`events.ts:573`）**同构**，`seenSeqRef`/`initialAfterRef` 对拍平形态的适配正确（均读 `e.seq`，而 live 帧 `:332` 亦把 `frame.seq` 挂在事件上，两侧游标/去重口径统一）。**但**镜像 `type='message'` 行仍无消费分支（详见问题 1）。

一句话：**r1 的「块间契约 + serve 托管」两个接缝这次真的接上了，唯独 web 事件语义面的最后一块（用户消息型）漏了。**

## 质量评分

**67 / 100**

| 严重度 | 条数 | 单扣 | 小计 |
|---|---|---|---|
| critical | 1 | -25 | -25 |
| high | 0 | -12 | 0 |
| medium | 0 | -5 | 0 |
| low | 4 | -2 | -8 |

扣分项：问题 1（镜像 `message` 型用户消息不渲染 → 验收 2 不达，含 web 类型值域仍缺 `message`/仍声明 `session.*.delta` 的同类漂移，**不重复扣分**）；问题 2（手抄缺 `lastActiveAt`）、3（h4 异步 error 用例未补）、4（`renderServeCommand` 未复用）、5（冒烟腿⑤ 进程清理与真实 DB 副作用）。

## fence 结果

Checker 在冻结树（`5cd21f5`，`git status` 干净）独立复跑：

- `pnpm -F @atd/server test`：**217 用例（17 文件）**，217 通过，0 失败，0 跳过（7.64s）——与 r1 同数（本轮**零新增用例**，与问题 3 一致）
- `pnpm -F @atd/worker-core test`：16 用例（2 文件），16 通过（0.29s）
- `pnpm -F @atd/worker-opencode test`：9 用例（1 文件），9 通过（0.23s）
- `pnpm -F @atd/server exec tsc --noEmit`：静默通过（exit 0）
- `pnpm -F @atd/web build`（`tsc --noEmit && vite build`）：成功（3069 modules；`index-CNPDiS6O.js` 1.205MB / gzip 379KB，3.75s；chunk 体积告警为存量现象）
- E2E 测试：无（本项目无 E2E 基建，与 S1/S2a/S2w1/S3 同口径）
- 合计：**242 用例，242 通过，0 失败，0 跳过**

> 复跑口径：`bash .specpipe/fence.sh` 整体脚本被本会话权限引擎拒绝（`bash` 不在白名单），按 r1 同口径分段等价复跑（四包 tsc + 三包 test + web build）。
>
> **冒烟（`scripts/smoke-humanthink.sh`）本轮未复跑**（其非 fence 项、需真 serve + LLM 轮次 + 起第二个真 ATD）。理由：腿⑤ 会以**真实 dataDir 库**启动 ATD（`index.ts:23/28` 走 migration + `recoverOnStartup`，可能触发排队单重校验/派发），且脚本对 ATD 的进程清理不完整（问题 5），我不宜在用户库上二次施压。采信：① 调度者实跑 SMOKE 五腿 PASS 的记录；② **真机留存物** `/tmp/opencode/ht-abs-debug/ev.log`（Builder 调试 leg④ 同型链路的原始 serve 帧，见下）——它同时为腿④ 的断言设计提供了直接证据。

## r1 → 修复闭合表（逐项裁定）

| # | r1 判定 | 修复落点 | 证据 | 裁定 |
|---|---|---|---|---|
| **c1** spawn env 未合并 → 真机 ENOENT → 永久 degraded | critical | `serve-manager.ts:106-111`（spread 在前、自有键在后）+ 单测 `:33` 断言 PATH 等值 + 冒烟腿⑤「经 ATD API」 | 代码形态与 `execution.ts` 惯例一致；单测断言 `opts.env.PATH === process.env.PATH` 直指根因；腿⑤ `GET /api/humanthink/sessions` 取 200（degraded 恒 503，`assertAvailable`） | **已闭合** |
| **c2** live delta 事件名两端不一致 | critical | `HumanThinkPage.tsx:97`（`text.delta`）、`:128`（`reasoning.delta`） | 与 `events.ts:607/611` 产物一致；web 全目录无 `session.*.delta` 消费点（仅声明残留，见问题 1 附注） | **已闭合**（声明面残留记 low，并入问题 1/2） |
| **c3** 详情 events 形状不一致（扁平 vs 包装） | critical | `types.ts:323-336` + `HumanThinkPage.tsx:275-284` | `seq/serveSeq/type/event/createdAt` 与 `routes.ts:31-38/200-206` 逐字段一致；拍平后 `timestamp=createdAt` 与回放帧 `events.ts:573` 同构；助手全文（`text.ended.data.text`）与审批行 `requestID/decision` 均可取 → 空气泡与幽灵/错关卡闭合 | **部分闭合**：第三条症状（`type='message'` 用户消息）未处理 → 问题 1（critical） |
| **h4** spawn 失败无 'error' 兜底 | high | `serve-manager.ts:120-123`（pid 检查前挂监听） | 位置正确（pid 空分支亦留监听）；r1 建议的「pid 空 + 异步 emit('error')」**用例未补** → 问题 3 | **代码已闭合，测试面未闭合** |
| r1 清单 #5 手抄完备性（`lastActiveAt`） | low | 未落 | `types.ts:292-304` 仍 7 字段 | **未闭合**（不阻塞，见问题 2） |
| r1 清单 #6 冒烟补两腿（经 ATD API / 绝对路径读） | — | `smoke-humanthink.sh:159-200`（腿④）、`:202-221`（腿⑤） | 腿④ callID 关联断言（下节细核）；腿⑤ 端口 3001 与 `index.ts:36` 缺省一致、`pnpm -F @atd/server start` 存在（`package.json:8`） | **已落**（断言质量见「腿④/腿⑤ 断言强度复核」+ 问题 5） |
| r1 清单 #7 spawn 环境继承断言 | — | `serve-manager.test.ts:32-33` | 1 行直断 PATH | **已闭合** |
| r1 清单 #8 `renderServeCommand` 复用 | low | 未落（`app.ts` 本轮未动） | — | **未闭合**（见问题 4） |

### 腿④/腿⑤ 断言强度复核（r1 修复清单余项）

**腿④（视野内绝对路径读）**——设计前提经真机证据**成立**：
- 「工具名仅在 `tool.input.started`」的断言依据正确：真机帧 `session.tool.input.started` 的 `data` = `{sessionID, assistantMessageID, id, name:"read"}`（`/tmp/opencode/ht-abs-debug/ev.log:43`），而 `session.tool.success` 的 `data` **不含 name**、只带 `content`（`:55`）——故必须按 `data.id`（callID）跨帧关联，脚本 `:189-195` 的 `name_by_call[data.id]` 做法与事实吻合；
- 成功回执形态正确：`session.tool.success.data.content` = `[{type:'text', text:"Read file /tmp/.../session/marker.txt, lines 1-1\n1: smoke-marker-ok"}]`（同帧），脚本 `:194` 的「content 含 marker.txt」判定有效；
- **区分度不足（不阻塞）**：脚本自身配置把 readable 设为 `dirname(SESSION_DIR)`（`:36`）→ session dir 落在 allow 面（`$WORK/*`）内，与真实 ATD 拓扑（session dir=主仓、**不在** allow 面）不同——若匹配器为前缀语义，该腿即便「绝对路径读被归 external_directory」也可能经 allow 而非规则③通过。**反例证据恰在调试目录**：`ht-abs-debug/config/opencode.json:26-35` 的 allow 面是 ATD 仓，session dir 在 `/tmp`（完全不在 allow 面）→ 绝对读**成功**，这才是 O1 的判别性证据（结论对 O1 有利，只是未固化进脚本）。

**腿⑤（经 ATD API 全链）**——断言形态合格：以 `/api/humanthink/sessions` 200 作为「ServeManager spawn→健康探测→ready」的判据，正是 c1 失败模式（degraded→503）的正面反演，属有效代理断言；端口占用前置检查（`:205-207`）避免误判。弱点见问题 5。

## 发现的问题

### 1. 镜像 `type='message'` 行（用户消息）在重开会话后整体不渲染 → 验收 2「内容完整」仍不达 —— 严重程度：critical

- 事实链（行级锚定）：
  - **服务端确认存在该型且必读通道返回它**：用户 prompt 即时落行 `insertOwnRow(sessionId,'message',{type:'message', role:'user', text})`（`events.ts:541-549`）；对账行同型（`:449-454`）；详情端点无过滤地返回全部行 `{seq, serveSeq, type, event: JSON.parse(payload), createdAt}`（`routes.ts:191-208`）；服务端测试**明确断言**该型存在：`api-s2b1.test.ts:179`（`e.type === 'message' && e.event.role === 'user'`）、`:208-210`（`msgRow.event` 含 role/text/messageId）。
  - **web 无消费分支**：`toChatItems`（`HumanThinkPage.tsx:92-186`）的 case 全集 = `user.prompt`(本地回显伪型，`:38`)/`text.delta`/`text.ended`(含 `role==='user'` 防御分支)/`reasoning.{started,delta,ended}`/`tool.{called,progress,success,failed}`/`permission.{asked,request,rejected,resolved}`，**无 `message`**，其余落 `:183-184` `default: break` → 整行丢弃。
  - 拍平后 `ev.type` 仍为 payload 内的 `'message'`（信封外层 `type` 与 payload `type` 同值，`routes.ts:203-204`），故解包不改变该行的丢弃结局。
  - 类型面同向：`HumanThinkEventType`（`types.ts:371-391`）无 `message`/`user.prompt`，`types.ts:405` 注释「镜像不含用户消息型」与实现相悖（正是 r1 指出的认知偏差残留）；`types.ts:390-391` 仍声明 `session.text.delta`/`session.reasoning.delta`（已无消费点）。因有 `(string & {})` 逃生位，tsc 不报错——**两侧各自 tsc 通过仍不构成契约证据**（与 r1 同一教训）。
- 影响（**每次重开任一会话即复现**，含「已删除」只读详情——`resetFromMirror` 是切换会话的唯一历史入口）：
  1. 验收 2「昨天/今天的会话打开**内容完整**」不达：用户自己说过的话全部消失，只剩助手单方面发言（助手全文本轮已修复）；
  2. 业务规则 5「历史可查」的服务端三分语义正确、**破在消费面**（与 r1 同一破法，只是换成了用户侧）；
  3. 验收 4 的边界体验连带受损：视野外拒绝/审批的**前置语境**（用户那句指令）不可见，回溯困难。
- 建议（约 10 行，单点）：
  1. `toChatItems` 增加 `case 'message':`——按 `ev.role` 分流（`'user'` → 用户气泡；否则走助手 text.ended 同款收口路径），可复用既有 `openMessage`/`text.ended` 分支逻辑；
  2. `types.ts:371-391` 值域补 `'message'`、删除 `session.text.delta`/`session.reasoning.delta`、修正 `:37`/`:405` 两处与实现相悖的注释；
  3. 服务端已有 `api-s2b1.test.ts:179` 的镜像断言为前提，建议 web 侧把 `toChatItems` 导出（或抽纯函数模块）补一小段用例锁定「user 行渲染 + assistant 行渲染」——本项目无前端测试基建，若维持现状则至少落一条断言注释锚定该契约。

### 2. 手抄残留：`HumanThinkSession` 仍缺 `lastActiveAt` —— 严重程度：low

- `types.ts:292-304` 7 字段（r1 清单 #5 未做）；UI 未消费该字段（列表排序由服务端 `lastActiveAt desc` 承担），无害。属手抄完备性，与问题 1 的类型面同类，本项独立计数。

### 3. h4 修复缺「pid 空 + 异步 `error`」用例（r1 清单 #2 测试面） —— 严重程度：low

- r1 明确指出测试模型与 Node 真实形态不符（libuv exec 失败 = 返回错误码 + 异步 `'error'` + pid 空），建议补一条「fake spawn 返回 pid 空 ChildProcess 但异步 `emit('error')`」并断言不抛出、走 degrade 链。本轮**只补了代码（`serve-manager.ts:120-123`），用例未补**：`serve-manager.test.ts` 仍是 5 例，失败路径仍只有 `:108-121` 的「同步 throw」模型。风险已由代码形态消除（我逐行核过 pid 空分支会 `return false` 且监听已挂），但回归护栏缺失，217 用例数与 r1 相同（零新增）即为佐证。

### 4. `renderServeCommand` 导出未复用（r1 清单 #8 / r1 问题 7） —— 严重程度：low

- `packages/worker-core/src/profile.ts` 的导出仅测试消费，`app.ts` 仍内联 `trim().split(/\s+/)` 渲染（含 `{port}` 替换在 `serve-manager.ts:104`），同一语义两处实现。

### 5. 冒烟腿⑤（新增）的进程清理与真实库副作用 —— 严重程度：low

- `( cd "$ROOT" && pnpm -F @atd/server start > "$ATD_LOG" 2>&1 ) & ATD_PID=$!`（`:209-210`）——`ATD_PID` 是**子 shell**；`kill "$ATD_PID"`（`:218`）不保证终止其子进程 `pnpm`/node，且 `index.ts` 未注册 SIGTERM/SIGINT 处理（全文 45 行无 signal 监听）→ Fastify `onClose`（`app.ts` 的 `serve.stop()`）可能不执行，**可能残留一个真 ATD + 一个 detached 的 opencode serve**（serve 以 `detached:true` 起独立进程组）。
- 副作用面：腿⑤ 用**真实 dataDir 库**启动 ATD，`index.ts:23`（migration）与 `:28`（`recoverOnStartup`：IN_PROGRESS→FAILED / DISPATCHED→CANCELLED + 排队单重校验）都会真执行；脚本仅在端口占用时提示「停掉在跑的 ATD 实例」。
- 建议：`ATD_PID` 侧改 `setsid`/进程组杀（`kill -- -$PID`），或 `trap` 里 `pkill -P`；并在脚本头注释记档「腿⑤ 以真实 dataDir 库启动 ATD，会执行 migration 与启动恢复」。
- 另（cosmetic）：`:157` 的 `echo "   ③ message 端点形态…"` 与 `:154` 的 python print 重复输出一行。

## 非扣分观察项裁定（r1 O1-O9）

| # | r1 观察项 | 本轮状态 | 裁定 / 后续处置 |
|---|---|---|---|
| O1 | 主仓绝对路径读的归类未闭环 | **已获真机证据**（`ht-abs-debug`：allow 面为 ATD 仓、session dir 在 `/tmp` → 绝对读成功，回执 content 载 marker）；但**冒烟脚本自身形态不具区分度**（readable=session 父级，见「腿④复核」） | 结论利好，**不转 Issue**；建议下次维护冒烟时把 readable 改为「不含 session dir 的目录」（固化判别形态），并把断言从「content 含 marker」升级为「同 callID 的 `input.path` 以 `/` 开头」（真机 `session.tool.input.ended.data.text` / `session.tool.called.data.input` 均载该路径，锚点齐全） |
| O2 | `onReady` seam 死置（注释称事件流重订阅钩子，实际重订阅由 `streamLoop` 轮询承担） | 未动（`app.ts` 本轮未改） | **转后续 Issue（1 行级）**：校正注释或删除 seam；避免后人误以为重订阅依赖它 |
| O3 | 对账翻页腿未覆盖（`fake-serve.ts` 的 `cursor.next` 恒 null） | 未动 | **转后续 Issue**：真机 message 分页 `next` 语义仍未定形（impl 已列风险），建议与冒烟合批复核 |
| O4 | 列表按 `lastActiveAt desc`，不发消息的会话因查看不前移 | 未动 | 记档即可，**不转 Issue**（符合「活跃」语义） |
| O5 | 退避 3 次后不再自动重试（需重启 ATD） | 未动 | **由 AGENTS.md 建议第 7 条承载**（交付后动作） |
| O6 | 共享数据目录下 saved 规则跨自用服务生效（D6+D3 缓解） | 未动 | **由 AGENTS.md 建议第 4 条承载**（用户已拍板接受面） |
| O7 | 单 serve 边界下 `workerId` 为展示/审计值 | 未动 | impl 技术方案 8 已记档，**不转 Issue** |
| O8 | fake-serve 保真度（未模拟 SSE 心跳注释行 / 401 态） | 未动 | 解析层已有忽略分支（`events.ts:211`），风险低，**不转 Issue** |
| O9 | `permission.rejected` 无 requestID 时不做幂等去重 | 未动 | 残留重复行风险低，**不转 Issue** |

## 验收标准 1-7 逐条核验（r2 状态）

| # | 验收（用户可验证） | r1 | r2 状态 |
|---|---|---|---|
| 1 | 会聊（逐字出现/思考折叠/工具卡） | ✗（serve 起不来 + delta 名不匹配） | **✓ 判定翻转**：c1 闭合后真机可达（腿⑤ 200 + 代码形态）；c2 闭合后 delta 帧进入累积分支；无前端自动化证据（存量口径） |
| 2 | 不丢话（内容完整、重启不丢不重） | ✗（渲染面破功） | **✗ 仍不达**：助手全文已恢复，**用户消息整体消失**（问题 1）；服务端数据层不丢（用例 + 对账双幂等） |
| 3 | 不干扰自用 opencode | ✓ | ✓（未动） |
| 4 | 有边界（视野外拒/敏感请示/视野内读） | ✓（O1 待闭环） | ✓；O1 另获真机证据（见观察项表） |
| 5 | 可打断 | ✓ | ✓（未动） |
| 6 | 不泄密 | ✓ | ✓（未动；env 合并后仍只多继承宿主变量，密码仍仅内存+子进程 env） |
| 7 | 不伤旧（全量测试绿） | △ | ✓（217+16+9 全绿；degraded 不阻塞用例在；h4 的未捕获异常风险已由 `:120-123` 消除） |
| — | 规则 5「历史可查」 | ✗ 消费面 | ✗ **仍破在消费面**（用户侧历史不可见，属于问题 1 的一部分） |

## 修复是否引入新问题（快扫 `41882e6..5cd21f5` 全 diff）

| 面 | 结论 |
|---|---|
| `{...process.env}` 泄露/冲突 | 键序正确（自有键在后覆盖）；密码仍随每次启动随机（`:105`）。**记档（勿扣分）**：合并后 `OPENCODE_CONFIG`/`OPENCODE_CONFIG_CONTENT` 等若存在于 ATD 进程环境，会一并传给 serve（原「整体替换」恰好屏蔽了这一点）；自用/worker 场景下出现概率低，建议观察 |
| 多挂一个 `on('error')` 与既有 `once('error')` 并存 | 无害：前者仅日志（覆盖 pid 空分支），后者驱动 `onCrashed`（仅 pid 非空分支注册，单次触发） |
| `as Record<string, string>` 断言健壮性 | 可接受但非类型安全：`process.env` 值为 `string\|undefined`，断言把 undefined 可能性抹掉；Node 运行时实际值为字符串，风险面仅是「类型系统不再防护未来写入非字符串」。若要洁癖，可 `Object.fromEntries(Object.entries(process.env).filter(([,v]) => v != null))`（低优先，未扣分） |
| 拍平后 `seenSeqRef`/`initialAfterRef` 适配 | **正确**：两处均按 `typeof e.seq === 'number'` 过滤，`initialAfterRef` 取 max；与 live 帧 `{...frame.event, seq: frame.seq}`（`:332`）口径统一；delta 帧无 `seq` → 不入去重集（设计如此） |
| `timestamp` 语义 | 拍平 `timestamp=row.createdAt` 与 server 回放帧（`events.ts:573`）一致、live 由 `:588` 补齐 → 无新增漂移 |
| 冒烟新增两腿 | 见「腿④/腿⑤ 断言强度复核」与问题 5；未引入假绿（腿④ 依赖真机帧结构，前提已由留存帧证实） |

## 修复清单（交 Builder · 建议同批落，单点小改）

| # | 项 | 文件 | 量级 |
|---|---|---|---|
| 1 | `toChatItems` 补 `case 'message'`（按 `ev.role` 分用户/助手气泡） | `apps/web/src/pages/HumanThinkPage.tsx:92-186` | 数行 |
| 2 | 值域补 `'message'`、删 `session.*.delta`、修正 `:37`/`:405` 与实现相悖的注释 | `apps/web/src/api/types.ts:367-419` | 3-5 行 |
| 3 | `HumanThinkSession` 补 `lastActiveAt`（r1 #5） | 同上 `:292-304` | 1 行 |
| 4 | 补「pid 空 + 异步 `emit('error')`」用例，断言不抛出并走 degrade 链（r1 #2 测试面） | `apps/server/test/humanthink/serve-manager.test.ts` | 1 用例 |
| 5 | `app.ts` 复用 `renderServeCommand`（r1 #8） | `apps/server/src/app.ts` | 1 行 |
| 6 | 冒烟腿⑤ 进程组清理（setsid / `kill -- -$PID`）+ 腿④ readable 改为不含 session dir 的目录 | `scripts/smoke-humanthink.sh:36/159/209-221` | 数行 |

> 第 1/2 项是本轮 REJECT 的全部技术理由；3-6 为 r1 遗留项（不阻塞，可同批顺手落）。修复后建议重递本门（无需回退 spec/impl）；真机闭环建议按 r1 同口径四步走（ATD 真机起 → 聊天发一句 → **刷新页面** → 断言含用户侧历史）。

## AGENTS.md 更新建议（交付后动作，本门不扣分）

r1 末节 7 条建议**仍成立且本轮无新增条目**，随 PASS 由调度者收尾执行（其中第 4 条 spawn 坑位、第 5 条 web 手抄契约比对纪律尤其值得写——本轮 c3 残留恰是第 5 条的再犯）。

## 状态落定

- 审查前实测 `.stage` = `QUALITY_GATE`（与质量门审查前状态一致）→ 本报告结论 **REJECT**，落定目标态 **`WORKING`**（builder 修复 → 重新递交）。
- 若状态机拒绝该边（或分派要求由调度者执行），则转由调度者落定；本报告技术结论不受影响。

## 结论

# REJECT

状态：QUALITY_GATE → WORKING

一句话理由：r1 的 4 处修复中 c1（spawn env 合并 + PATH 断言 + 冒烟腿⑤）、c2（live delta 短名对齐）、h4（`'error'` 监听前移）**全闭**，c3 的信封面（`HumanThinkMirrorRow` + 拍平，字段与 `routes.ts` 序列化逐字段一致、与回放帧同构）也已正确落地，助手历史空气泡与审批卡幽灵/错关随之消失；但 r1 c3 的第三条症状、r1 修复清单第 4 项明列的「补 `message` 型与 role 处理」**未落**——镜像中用户消息为 `type='message'`（服务端 `api-s2b1.test.ts:179` 断言的正是它），web `toChatItems` 无该分支而落 `default` 丢弃，**每次重开会话，用户自己说过的话全部消失** → 验收 2「昨天的会话今天打开内容完整」与规则 5「历史可查」仍不达（修复面为 web 单点约 10 行：一处 `case` + 值域/注释三行）—— 67/100 REJECT。

---

*附：本轮零新增用例（217+16+9 与 r1 同数）、`git status` 复跑前后均空、冒烟未复跑（理由见 fence 节），真机证据取自 `/tmp/opencode/ht-abs-debug/`（Builder leg④ 调试留存帧）与调度者 SMOKE 五腿 PASS 记录。*
