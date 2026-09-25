# 质量门审查报告: atd-s2b1-humanthink (Revision 1)

> 终检判定：**REJECT（5/100）**。七项清单中 4 项通过、3 项不通过；**3 处 critical + 1 处 high 全部集中在「块间契约衔接」与「serve 托管启动」两个接缝上**，且均有实证链（libuv 源码 + 本机路径实测 + 双侧代码/测试互证）。根因单一、修复面小（≈4 处、均为局部改动），但当前树上**真机聊天功能不可用 + 验收 1 的逐字流式恒不渲染 + 验收 2 的「昨天的会话今天打开」恒为空**，故不通过。
>
> 修复后建议直接重递本门（无需回退 spec/impl）：三处契约对齐 + 一行 env 合并 + 一处 'error' 兜底。

- 类型：Story 质量门全面审查（S-S9 质量门 · 首轮 / r1）
- 对象：worktree `/home/starlex/project/ATD-s2b1-server`，分支 `dev/feat/atd-s2b1-humanthink` @ `41882e6`
- commit 范围：基线 `8aa5e62` → `fa21077`（块 1 server+worker-core）→ `f59b68d`（块 2 web）→ `9e1e879`（合流）→ `41882e6`（对账裁决三补）；`git diff --stat 8aa5e62..41882e6` = **37 文件 +5234 / -13**
- 事实源：spec v7（业务语言版，验收按业务语义逐条核）/ impl v2.1 / **契约唯一事实源 `probe-report.md`（含 0 号补录）** / 项目 `AGENTS.md`；三文档在 worktree `.specpipe/plans/atd-s2b1-humanthink/` 与主仓同路径齐备（含 spec r1-r5、impl r1-r3 审查链）
- 状态校验：实测 `.stage` = `QUALITY_GATE`（与质量门「审查前状态」一致）→ 允许落定
- 独立复跑后 `git status --porcelain` 为空（未改一文件；`apps/web/dist/` 为 gitignore 内构建产物）
- 日期：2026-09-26

## 总体评价

**不通过**。S2b1 的骨架落码质量高：impl 技术方案 1-8 与 D1-D8 逐项可核（配置生成五规则序列硬编码、幂等键 `(session_id, serve_seq)`、对账触发=全局流连接建立时、审批 once/reject 两档、D8 旁路位、零新依赖），事件子系统（镜像/对账/审批/SSE 合流）设计完整，migration 0005 与 schema 一致，217+16+9 用例全绿且断言强度高（幂等真值、退避三档、degraded 全端点枚举、软删三分语义五端点 422）。**但两个接缝失守**：

1. **块 1 的 serve 托管在本机必然起不来**——spawn 时 `env` 整体替换而非合并 `process.env`，子进程无 `PATH`；libuv 在无 PATH 时按 `_PATH_DEFPATH = "/usr/bin:/bin"` 解析可执行文件，而本机 `opencode` 仅存在于 `~/.opencode/bin/opencode` → ENOENT → 首启失败 → 三次退避后永久 degraded → humanthink 9 端点全量 503（`api-s2b1.test.ts` 的 degraded 用例正是这一终态）。该路径**未被任何测试或冒烟覆盖**（冒烟脚本自行 spawn serve、继承调用者环境，绕过 ServeManager）。
2. **块 2 手抄的事件契约与 server 实际帧/载荷形态三处漂移**——live delta 事件名（`session.*.delta` vs 实际 `*.delta`）、详情内嵌事件形状（扁平 vs 包装 `{seq,serveSeq,type,event,createdAt}`）、镜像值域（web 缺 `message` 型）。`pnpm -F @atd/web build` 的 tsc 通过**不能**校验手抄正确性，正是本门要抓的面。

两者叠加的后果是：真机「会聊」不可达；即便 serve 起来，验收 1 的「逐字流式出现」与验收 2 的「昨天的会话今天打开内容完整」也恒不成立。

## 质量评分

**5 / 100**

| 严重度 | 条数 | 单扣 | 小计 |
|---|---|---|---|
| critical | 3 | -25 | -75 |
| high | 1 | -12 | -12 |
| medium | 0 | -5 | 0 |
| low | 4 | -2 | -8 |

扣分项：1（spawn env 未合并 → 真机 serve 必然 ENOENT）、2（live delta 名不匹配 → 流式恒不渲染）、3（详情事件形状不匹配 → 历史渲染破功）、4（spawn 失败路径无 'error' 兜底），见「发现的问题」；4 处 low 见同节。

> 说明：评分按本门公式机械计算，与「实现忠实度/测试质量」无关——若 4 处修复落地（局部改动、无架构返工），本门预期回到 88-93 区间。

## fence 结果

Checker 在冻结树上独立复跑（同一 worktree、未改一文件）：

- `pnpm -F @atd/worker-core test`：16 用例（2 文件），16 通过，0 失败，0 跳过（0.28s）
- `pnpm -F @atd/worker-opencode test`：9 用例（1 文件），9 通过，0 失败，0 跳过（0.22s）
- `pnpm -F @atd/server test`：**217 用例（17 文件）**，217 通过，0 失败，0 跳过（7.39s）—— 逐文件：perm-config 3 / file-set 8 / **config-gen 10** / workspaces 10 / **serve-manager 5** / api-s3 5 / state-machine-s2a 18 / workspace-contract 12 / state-machine 20 / api 11 / api-s2a 16 / **events 13** / ticket-service 36 / worktree 9 / **api-s2b1 11** / workspace-crossrepo 3 / dispatcher 27
- 三包 `tsc --noEmit`（server / worker-core / worker-opencode）：静默通过
- `pnpm -F @atd/web build`（`tsc --noEmit && vite build`）：成功（3069 modules；`index-IHq0ZNQV.js` 1.205MB / gzip 379KB，2.99s；chunk 体积告警为存量现象）
- E2E 测试：无（本项目无 E2E 基建，与 S1/S2a/S2w1/S3 同口径）
- 合计：**242 用例，242 通过，0 失败，0 跳过**

> 复跑口径说明：`bash .specpipe/fence.sh` 整体脚本被本会话权限引擎拒绝（`bash`/`node -e` 不在白名单），故按其分段等价复跑（四包 tsc + 三包 test + web build）；未复跑 `pnpm install --frozen-lockfile`（node_modules 在位、锁定态一致，测试与构建均正常）。与调度者收尾验证（ALL GREEN）结论一致。

## 七项清单逐项结论

### 1. 实现与 impl 一致性 —— 通过

impl §技术方案 1-8 与 D1-D8 逐项落码核对：

| impl 条目 | 实测落点 | 判定 |
|---|---|---|
| 技术方案 1 serve 托管（端口/密码/配置目录、5s 健康探测、退避 3 次转 degraded、onClose 清理、`humanthink.enabled` 旁路） | `serve-manager.ts:80-200`（`probeFreePort:228-246`、`stop():203-224` 杀进程组）；`app.ts:169-181/194-208`；`index.ts:29-35` 启动时序在 listen 前 | ✓（env 合并缺陷见问题 1，属实现细节偏离而非方案偏离——既有惯例 `execution.ts:62`） |
| 技术方案 2 config-gen（白名单 `{model,providers}`、V1 单数键等价提取、禁入键、五规则硬编码顺序、幂等重写、唯一写目标） | `config-gen.ts:84-104`（提取）/`114-127`（五规则）/`133-143`/`146-151`（唯一写入口） | ✓ |
| 技术方案 3 会话面 v2（`POST /api/session` + location/title、prompt `{text}`、interrupt、DELETE、404 兜底） | `session-facade.ts:66-98`（探针漂移 1 `text` 字段已落）；404→`SESSION_NOT_FOUND`（`:52`） | ✓ |
| 技术方案 4 事件双通道（delta 不落库、durable 子集落库、`(session_id,serve_seq)` 幂等、信封缺失跳过+warn、对账=连接建立时、message 权威、应用层幂等） | `events.ts:64-74/243-286/276-286/161-184:172-173/414-455/340-367` | ✓ |
| 技术方案 5 审批中转（live asked 即推、2s 轮询兜底、reply once/reject、ATD 自有两行） | `events.ts:369-387/457-538`；`routes.ts:271-305`（`always` 在 zod 枚举即 400） | ✓ |
| 技术方案 6 UnifiedEvent 扩展两型 + humanthink 映射 | `packages/worker-core/src/events.ts`（两型）；`events.ts:667-702`；task 映射器零改动（diff 未触及 `map-events.ts`） | ✓ |
| 技术方案 7 不引 SDK（原生 fetch + 手写 SSE） | `session-facade.ts:45`、`events.ts:164-215`（手写分帧）；`package.json` 零新增依赖（37 文件 diff 无 package.json） | ✓ |
| 技术方案 8 单 serve 边界（`serveCommand` 渲染、非 opencode 形态标记不可用） | `profile.ts:99-103`（`isInteractiveServeCompatible`）；`routes/workers.ts:14` | ✓ |
| D2 catch-all ask 首条硬编码 | `config-gen.ts:116`（序列首条，生成器硬编码） | ✓ |
| D3 always 不开放 | `routes.ts:64` zod 枚举；`session-facade.ts:107` 只透传两档 | ✓ |
| D8 旁路位（既有测试零 serve 进程） | `app.ts:169`、`helpers.ts:103/206`（缺省 `enabled:false`）、`api-s2b1.test.ts:90-95`（缺省 404 断言） | ✓ |
| schema/migration 0005（两表 + 双唯一索引） | `schema.ts:138-179`、`0005_s2b1_humanthink.sql`（`uq_ht_event_serve_seq`/`uq_ht_event_seq`）+ meta 快照 | ✓（比 impl 多一条 `seq` 唯一索引，见偏差复核） |

### 2. 代码质量（OCR 流水线）—— 通过（含问题 1/4 的实现缺陷）

规则注入：按变更文件后缀加载 `ts_js_tsx_jsx.md`（37 文件中 35 个 `.ts/.tsx`）+ `yaml.md`（`config.yaml`/`workers/opencode.yaml`）+ `sql.md`（`0005_*.sql`）+ `json.md`（meta 快照）；无 `default.md` 兜底触发。

- **正确性**：幂等键与本地 seq 分配无空洞（`insertMirrored` 冲突时回退 seq 缓存 `events.ts:330-334`）；`attach` 的「先注册监听再回放」为同步整段、注释已论证原子性（`:553-557`）；审批行 `status` 翻转用 `json_set` 同库原子写（`:379-385`）；对账/轮询/流循环全部 try/catch 隔离单会话异常。
- **清洁度**：无 `TODO/FIXME`、无 `as any`/`@ts-ignore`/`eslint-disable`、无 `console.log` 残留（`log` 统一 `[atd-humanthink]` 前缀）；注释全中文且终态化（无「旧口径/替代/rev」字样）。
- **性能**：`knownSession` 每事件一次主键查询（单用户规模可接受）；`toolNames` Map 有 1000 上限自我裁剪；SSE 回放为 seq 有序全量（单会话行数有限）。
- **安全**：无外部输入直入 SQL（Drizzle 参数化 + `json_extract` 参数绑定）；`payload` 仅 JSON 文本；`open`/写文件动作仅 config-gen 一处且目标固定。
- **前端**：事件归并函数 `toChatItems` 为纯函数（易单测，但本项目无前端测试基建）；hook 顺序稳定；SSE 自管重连（关闭原生重连以避免复用旧 `after` URL，`humanthink.ts:187-194`）—— 该设计判断正确。
- **缺陷项**：问题 1（env 未合并）、问题 4（失败路径无 'error' 兜底）落在 `serve-manager.ts` 的进程管理面；问题 2/3 为手抄契约漂移（web 侧）。

### 3. commit 信息 —— 通过（1 处 low）

区间 5 个 commit：`fa21077`（块 1）、`f59b68d`（块 2）、`9e1e879`（merge）、`41882e6`（三补）。四个特性/补丁 commit 主题为简洁中文 + 正文按交付面分条（引擎/契约/测试/旁路位），符合本仓既有风格（对照 S2a/S2w1/S3 各 commit）；`41882e6` 的三补正文逐项对齐块间对账结论，可审计性好。merge `9e1e879` 为 git 默认英文主题 —— 见问题 8（low，与 S3 同型）。

### 4. 整体编译 —— 通过

三包 `tsc --noEmit` 静默通过；web 侧 `tsc --noEmit` 随 build 通过；无类型逃逸。**注意**：本题的 critical 项 2/3 恰是「类型层面自洽、语义层面不一致」——两侧各自 tsc 通过不构成契约证据（本门专项比对见「块间契约逐字段比对」节）。

### 5. 受影响模块测试（fence）—— 通过

见「fence 结果」节：分段等价复跑 242/242 全绿；`git status` 复跑前后均干净。

### 6. 测试覆盖与回归 —— 不通过（覆盖缺口与 critical 同源）

**新增 48 用例**（server 39 = config-gen 10 + events 13 + serve-manager 5 + api-s2b1 11；worker-core 9 = profile-interactive）：

| 新增用例（文件 · 摘要） | 断言强度要点 | 覆盖 |
|---|---|---|
| config-gen ×10 | 白名单/禁入键/jsonc（含字符串内注释符不剥）/V1 单数键等价提取/幂等重写/五规则**序列全等**断言 | 规则 2 载体、D1/D2 |
| events ×13 | 幂等去重后 seq 不跳号、信封缺失仅转发+warn、外来会话丢弃、对账双幂等（重复对账 + 已镜像 assistant 跳过）、SSE after 回放三段、审批轮询补 resolved | 规则 5/6、技术方案 4/5 |
| serve-manager ×5 | 健康探测通过/失败两态、崩溃退避回 ready + onReady 复触发、端口递补真占位 | 规则 7 |
| api-s2b1 ×11 | 9 端点契约 + 四错误码 + 三分语义五端点 422 枚举 + always 400 + degraded 8 端点 503 且工单 200 | 规则 3/4/5/7 |
| profile-interactive ×9 | `{port}` 必含、凭据扫描复用、非 opencode 形态标不可用、两型 UnifiedEvent | 规则 6、技术方案 8 |
| （三补 2 例）`deleted=1` 枚举 + `available` 透出 | 逐字段真值 | 块间对账 |

**覆盖缺口（4 处，均与 critical/high 同源）**：
1. **无「spawn 环境继承」断言**：`serve-manager.test.ts:28-34` 只断言 `OPENCODE_SERVER_PASSWORD`/`OPENCODE_CONFIG_DIR` 两键存在，fake 的 `lastSpawnEnv` 已可断言 `PATH` 却未用 → 问题 1 完全不可见。
2. **spawn 失败模型与 Node 真实形态不符**：`serve-manager.test.ts:106-119` 用「spawnImpl 同步 throw」模拟 ENOENT；而 libuv 的 spawn 失败是**返回错误码 + 异步 'error' 事件**（libuv 源码注释即为此：「nodejs 期望 initialized streams, even if the exec failed」）→ 问题 4 路径未被覆盖。
3. **web 侧零自动化**（项目现状，与 S2a/S3 同口径）：`build` 的 tsc 不校验手抄契约，问题 2/3 无护栏。
4. `fake-serve.ts:167` 的 message 分页 `cursor.next` 恒 null → 对账**翻页腿**（`events.ts:417-424` 的 `cursor` 循环）无用例；SSE 心跳注释行与 401 态亦未覆盖。

**回归口径（验收 7 前半）**：`api-s2b1.test.ts`/`humanthink/*` 为纯新增；`helpers.ts` 仅补 `humanthinkPort` + 旁路位（既有 13 文件零 serve 进程，`humanthink.enabled` 缺省 false 保证）；存量 178 用例断言未改；17 文件 217 用例全绿（含 S2a/S2w1/S3 全链），存量行为零回归成立。

### 7. 文档归档与 AGENTS.md —— 通过（含交付后动作）

- spec v7 / impl v2.1 / probe-report 在 worktree 与主仓同路径齐备；审查链齐备（spec r1-r5、impl r1-r3 双向可见）。
- **AGENTS.md 未随 S2b1 更新**（全仓 0 处 `humanthink`/`聊天` 命中）：现文缺聊天语义（9 端点族、事件双通道与幂等键、软删三分、三档五规则、serve 托管与 `humanthinkPort`、单 serve 边界）。按 S2w1/S3 终检先例（AGENTS.md 属交付后动作、不扣分），本项**不扣分**；归属判定：**交付后动作**，建议清单见末节（建议与本次修复同批落，因为问题 1 的 spawn 环境规则值得写进 §三 坑位）。

## 验收标准 1-7 逐条核验（spec v7 业务语义）

| # | 验收（用户可验证） | 代码落点 | 用例 | 判定 |
|---|---|---|---|---|
| 1 | 会聊：选 worker × workspace → 发消息 → 回复逐字出现；思考折叠；工具动作卡片 | 建会话 `routes.ts:120-155`；流式 `humanthink.ts:155-207` + `HumanThinkPage.tsx:96-143`；工具卡 `ToolCard.tsx` | api-s2b1 建会话/prompt；无前端用例 | **✗ 不达**：真机 serve 起不来（问题 1）→ 全端点 503；即便起来，delta 名不匹配使「逐字出现」恒不成立（问题 2） |
| 2 | 不丢话：昨天的会话今天打开内容完整；重启后续聊不丢不重 | 落库/对账 `events.ts:316-455`；详情 `routes.ts:191-208` | events 对账双幂等 + api-s2b1 详情行断言（**服务端 ✓**） | **✗ 不达**：数据层不丢（用例锁定），但重进会话的渲染面破功——助手全文取不到、用户消息整体丢弃（问题 3） |
| 3 | 不干扰：自用 opencode 不受影响 | 独立端口（`probeFreePort`）/独立密码（`randomBytes(24)`）/独立 `OPENCODE_CONFIG_DIR`/独立进程组；D6 数据目录共享为用户拍板 + D3 缓解 | serve-manager ×5 | ✓（生成配置只写 dataDir，见规则 6） |
| 4 | 有边界：视野外拒、敏感动作弹请示、视野内读正常 | `config-gen.ts:114-127` 五规则 + `json` 白名单 | config-gen 规则序列全等断言 | ✓（服务端口径齐备）；主仓绝对路径读的归类未真机闭环 → 观察项 O1 |
| 5 | 可打断：生成中点停止 → 立即停、可续问 | `session-facade.ts:88-93`（v2 interrupt 透传）+ `HumanThinkPage.tsx:447-454/619-628` | api-s2b1 interrupt 透传断言 | ✓（中断面存在性已由探针与冒烟锁定） |
| 6 | 不泄密：密钥只存内存、不落进仓库任何文件 | 密码 `serve-manager.ts:105`（每次启动随机、仅 env）；生成配置唯一写目标 `{dataDir}/opencode-config/opencode.json`（`config.yaml` dataDir=`~/.local/share/atd`，**仓外**）；用户全局按白名单提取 | config-gen ×10 | ✓ MUST-6 边界成立 |
| 7 | 不伤旧：原有工单功能全部照旧（全量测试绿） | 旁路位 + degraded 不阻塞 | 217/217 + `api-s2b1.test.ts:282-285`（degraded 下工单 200） | △ 测试面 ✓；但问题 1/4 的启动期失败→未捕获异常风险可能连带工单功能 → 见问题 4 |

## 业务规则 1-10 逐条核验

| # | 规则 | 落点 | 判定 |
|---|---|---|---|
| 1 | 会话归属：一个会话属一个 workspace；工作位置=主仓 | `routes.ts:128-131`（`resolveRepoPath(ws, null)`=主仓，落 `directory`）；`createSession` 带 `location.directory` | ✓ |
| 2 | 视野=主仓+可读仓，系统硬约束 | `config-gen.ts:114-127`（②deny `external_directory /**` + ④⑤ per readable 仓双动作 allow）；`buildServeConfig` 每 workspace 一个 `atd-ht-{ws}` agent | ✓（载体=serve 装载，非助手自觉） |
| 3 | 行为三档：视野内读自由 / 视野外系统拒 / 其余请示 | 规则序列 ①ask（catch-all 硬编码首条，D2）②deny ③allow | ✓ 与探针 P1b 口径一致（`*:*` 形态不可用已被探针排除） |
| 4 | 裁决粒度：只对当次生效 | `replyBody` 枚举 `once|reject`（`routes.ts:63-66`）；`always` → 400（`api-s2b1.test.ts:228-230`）；注释记明 saved 按 projectID 共享的扩散风险 | ✓ |
| 5 | 软删除：列表消失、历史可查、不能再发 | 列表 `isNull/isNotNull(deletedAt)`（`:160-163`）；详情为唯一含已删读通道（`:191-208`）；操作端点 `assertActive` → 422（五端点 422 用例） | ✓ 服务端；**✗ 前端消费面**（问题 3） |
| 6 | 断线与恢复：自动拉起 + 补齐中断期间记录 | `ServeManager.onCrashed/scheduleRestart/restartTick`（`:162-200`）+ `EventHub` 重连后 `reconcileAll`（`:138-184`）+ message 权威兜底 + 幂等键 | ✓（口径齐备；真机 serve 重启腿未端到端验证，被问题 1 阻断） |
| 7 | 附属关系：ATD 起停、起不来提示不可用、工单不受影响 | `app.ts:176-179` onClose → `events.stop()+serve.stop()`；degraded 全端点 503 且工单 200（用例） | ✓ 设计；✗ 受问题 1/4 威胁 |
| 8 | 名单时效：运行期不变，改配置需重启 | config-gen 仅在 `start()` 时执行一次（`app.ts:222-231`） | ✓ |
| 9 | 检索：标题+内容关键字 | `routes.ts:175-186`（title `includes` + payload `LIKE`） | △ 可用；语义宽泛（JSON 结构也命中）→ 观察项 O3 |
| 10 | 连接边界：浏览器只连 ATD | web 同源 `fetch`/`EventSource`（`humanthink.ts:25/169`）；serve 仅 127.0.0.1 + Basic auth | ✓ |

## 块间契约逐字段比对（本门特有重点）

事实源：server 侧 `apps/server/src/routes/types.ts`（镜像 re-export）+ `humanthink/routes.ts` 实际序列化 + `humanthink/events.ts` 帧形态 **vs** web 侧 `apps/web/src/api/types.ts` 手抄 + 实际消费。

| 契约面 | server 实际 | web 手抄/消费 | 判定 |
|---|---|---|---|
| 列表/详情 `SessionInfo` | 8 字段：`id/workerId/workspaceId/directory/title/createdAt/lastActiveAt/deletedAt`（`routes.ts:20-29`） | 7 字段，**缺 `lastActiveAt`**（`types.ts:292-304`） | △ 无害（列表按服务端 `lastActiveAt desc` 排序、UI 未用该字段），记 low |
| 详情 `events` 形状 | `{seq, serveSeq, type, event, createdAt}[]`（`routes.ts:32-38/194-207`；server 测试按此断言 `api-s2b1.test.ts:177-179/207-210`） | `HumanThinkEvent[]`（扁平，`types.ts:324-327`）；消费取 `ev.text`/`ev.requestID`/`ev.role` | **✗ 致命** → 问题 3 |
| 镜像 type 值域 | 14 型（`events.ts:18-32`，含 `message`、`permission.asked/rejected`） | 16 型（`types.ts:362-382`）：**缺 `message`**，多 `session.text.delta`/`session.reasoning.delta` | **✗** → 问题 2/3 |
| live delta 帧事件名 | `text.delta` / `reasoning.delta`（`events.ts:35-37/245-248`） | 消费 `session.text.delta` / `session.reasoning.delta`（`HumanThinkPage.tsx:96/127`） | **✗ 致命** → 问题 2 |
| SSE 帧外层 | `{seq?, event}`（`routes.ts:224-227`；`SseFrame` 带 `timestamp`——三补已落，回放=`createdAt`、live=`now`，`events.ts:573/588`） | `HumanThinkEventFrame {seq?, event}` + `event.timestamp?`（`types.ts:413-416/392-393`） | ✓（`41882e6` 三补的正确衔接面） |
| `deleted` 枚举 | `['1','0','true','false']`，`1/true`=仅已删（`routes.ts:74-75/160`） | `deleted=1`（`humanthink.ts:71`） | ✓ |
| `available` | 仅 interactive worker 透出 boolean，其余 `undefined`（`workers.ts:14`） | `available?: boolean` + 过滤 `!== false`（`HumanThinkPage.tsx:399`） | ✓ |
| 错误码 | `WORKER_UNAVAILABLE`503 / `SESSION_NOT_FOUND`404 / `SESSION_TERMINATED`422 / `WORKER_UNKNOWN`422 / `WORKSPACE_UNKNOWN`422 / `VALIDATION`400 | web 消费 `WORKER_UNAVAILABLE`（降级态）、`SESSION_TERMINATED`（转只读） | ✓ |
| 9 端点路径/方法/载荷 | 与 impl「API 契约冻结」节逐条一致（含 prompt `{text}`、reply `{decision,message?}`、`{admitted:true}`/`{ok:true}`） | 逐条对齐（`humanthink.ts:53-130`） | ✓ |
| 镜像 `permission_resolved.decision` | 可选（流内 `permission.replied` 可为 `always`） | 限 `'once'|'reject'` | △ 类型收窄，消费上 `=== 'once' ? approved : rejected` 不会误判 approved，记 low |

**结论**：9 端点与错误码面完全对齐，`41882e6` 三补确实闭合了「已删枚举 / 帧 timestamp / workers available」三处；但**事件语义面三处漂移未被发现**——它们全部落在「web 手抄时按 serve 事件名/理想扁平形状书写」这一认知偏差上，且因两侧各自 tsc/测试自洽而隐形。

## 偏差与决策复核（调度者初裁的复核）

说明：Builder 交付报告未入库（`.specpipe/plans/` 仅 spec/impl/probe-report），故本节以「代码 vs impl 逐项 diff」重新导出偏离项并复核，避免仅凭转述背书。

| # | 偏离/决策 | 复核 | 裁定 |
|---|---|---|---|
| ① | `spawn` env 未合并 `process.env`（impl 未写死此点，但既有惯例 `execution.ts:62` 为 `{...process.env, ...opts.env}`） | **不接受**：见问题 1（真机必然 ENOENT） | 需修 |
| ② | 新增 `apps/server/test/humanthink/fake-serve.ts`（impl 清单外） | 必要且高质量：D7「单测全 mock」的唯一可行承载（内存路由表 + 可控 SSE + 假进程 + `lastSpawnEnv` 断言钩子） | 接受；建议 impl 补录一行 |
| ③ | schema 多一条 `uq_ht_event_seq` 唯一索引（impl 只列 `(session_id, serve_seq)`） | 合理增强：本地 seq 展示序唯一性由 DB 兜底，与 `nextSeq` 分配一致 | 接受 |
| ④ | 镜像值域多 `message` 型（impl 清单列了 ATD 自有两型但未列 message） | 必要：对账行/用户即时行的承载型；**但 web 值域未同步** → 问题 3 的一半 | 接受实现；**必须同步 web** |
| ⑤ | `deleted=1` 枚举参数（`41882e6` 补，块 2 的「已删除」入口依赖） | 必要（impl 正文只写「列表排除 deleted」） | 接受 |
| ⑥ | `permission.replied` → `permission_resolved` 映射与「消失的 pending 补 resolved」轮询策略（impl 只写 2s 轮询） | 合理增强：裁决同步双保险（live 事件 + 本端 `recordReply` + 轮询兜底） | 接受 |
| ⑦ | `ServeManager.onReady` seam 未被装配接线（注释称「事件流重订阅钩子」） | 实际重订阅由 `streamLoop` 轮询 `deps.serve()` 承担（`events.ts:143-147`），非缺陷但 seam 死置 → 观察项 O2 | 接受；建议注释校正或移除 |
| ⑧ | `renderServeCommand`（worker-core 导出）未被 app.ts 复用（内联 `trim().split(/\s+/)`，`app.ts:198`） | 逻辑重复（两处同一渲染语义），测试仅覆盖导出函数 → low（问题 7） | 建议收敛 |
| ⑨ | 主仓未列入 allow 面（④⑤ 仅 readable 仓） | 依赖「session directory 内绝对路径仍归类 `read`」的二进制语义，探针未覆盖该形态 → 观察项 O1 | 留档 + 建议补冒烟断言 |

## 发现的问题

### 1. serve 托管 spawn 未合并父进程环境 → 本机 `opencode` 必然 ENOENT，聊天功能全量不可用 —— 严重程度：critical

- 事实（行级锚定 + 实证链）：
  - 代码：`serve-manager.ts:104-110` 构造 `env = { OPENCODE_SERVER_PASSWORD, OPENCODE_CONFIG_DIR }` 后整体替换子进程环境（Node `spawn` 的 `env` 语义 = 替换，非合并）；对比既有惯例 `execution.ts:60-65` 的 `env: { ...process.env, ...opts.env }`。
  - 可执行文件解析：`workers/opencode.yaml:10` 的 `serveCommand: opencode serve --port {port}` → `commandTemplate[0] = 'opencode'`（**不含斜杠**）；libuv 源码 `src/unix/process.c`：`uv__spawn_resolve_and_spawn` 仅当 file 含 `/` 时跳过 PATH 解析，否则 `path = uv__spawn_find_path_in_env(env)`，**env 内无 PATH 时回退 `#define _PATH_DEFPATH "/usr/bin:/bin"`**。
  - 本机实测：`opencode` 在 `/home/starlex/.opencode/bin/opencode`；`/bin`、`/usr/bin`、`/usr/local/bin`、`~/.local/bin` 均无该文件（python3 `os.path.exists` 五项逐一实测）。另以 python3 复现同一 POSIX 回退语义：`env={'OPENCODE_CONFIG_DIR':...}` → `FileNotFoundError`；继承环境 → `opencode v2.0.16` ✓。
  - 终态：`launchOnce` 失败 → `start()` 转 degraded + 退避 3 次 → 永久 degraded → `assertAvailable` 全 9 端点 503（`api-s2b1.test.ts:259-286` 正是该终态的断言）。
  - 次要面：丢失 `HOME`/`XDG_*` 亦影响 serve 的数据目录解析（与「会话持久于共享数据目录、重启 sessionID 不变」的 D6 前提相关）。
- 影响：**验收 1「会聊」在真机不可达**；业务规则 1/2/3/4/5/6 全部依赖 serve ready → 聊天页恒显「服务不可用」。这是交付物的主功能失效，且因「测试用 fake spawn + 冒烟脚本绕过 ServeManager」而全绿通过。
- 建议（1 行修复 + 1 个断言）：
  1. `env: { ...process.env, OPENCODE_SERVER_PASSWORD: ..., OPENCODE_CONFIG_DIR: ... }`（与 `execution.ts` 惯例一致）；
  2. `serve-manager.test.ts` 补断言：`expect(opts.env.PATH).toBe(process.env.PATH)`（fake 已记录 `lastSpawnEnv`）；
  3. 冒烟脚本补一条**经 ATD API** 的腿（或至少断言 ATD `GET /api/humanthink/sessions` 在启动后 20s 内非 503），使「serve 托管」纳入真机证据面。

### 2. live delta 事件名两端不一致 → 「逐字流式出现」恒不渲染 —— 严重程度：critical

- 事实：
  - server 发帧用短名：`events.ts:35-37`（`{type:'text.delta'|'reasoning.delta'}`）、`:245-248`（delta 仅转发）、`routes.ts:224-227`（`data: {seq?,event}` 原样序列化）。
  - web 消费用 serve 原名：`HumanThinkPage.tsx:96`（`case 'session.text.delta'`）、`:127`（`case 'session.reasoning.delta'`）→ 两型都进 `default` 丢弃；`types.ts:381-382` 亦把 `session.*.delta` 声明为 live 帧值域。
- 影响：助手回复与思考过程**不逐字出现**（`text.ended`/`reasoning.ended` 到达才一次性显示全文）→ 验收 1「回复逐字流式出现」直接不达；`openMessage`/`openReasoning` 的「先 delta 累积、全文到达对齐收口」设计路径整体失效（`toChatItems:96-143` 的流式分支成为死代码）。
- 建议：web 侧改判 `text.delta`/`reasoning.delta`（并修 `HumanThinkEventType` 注释与值域）；若要保留 serve 原名，则 server 转发时统一改名——**以 server `HumanThinkEvent` 短名为准**（它已是 SSE 帧契约与 `routes/types.ts` 镜像的既有口径）。

### 3. 详情内嵌事件形状两端不一致 → 重进会话历史渲染破功（含审批卡幽灵/错关） —— 严重程度：critical

- 事实：
  - server 返回包装对象数组：`routes.ts:194-207` → `{seq, serveSeq, type, event: HumanThinkEvent, createdAt}`，类型声明 `routes.ts:32-38`；server 测试按包装形状断言（`api-s2b1.test.ts:177-179`「`e.type==='message' && e.event.role==='user'`」、`:207-210`「`msgRow?.event.messageId`」）→ **服务端行为与意图明确**。
  - web 手抄为扁平：`types.ts:324-327`（`events: HumanThinkEvent[]`）；消费 `HumanThinkPage.tsx:274-281`（`resetFromMirror` 只从 `e.seq` 取值——该字段恰好两端都有，故游标/去重仍正确，掩盖了形状错误）。
- 影响（重进/刷新任意会话即复现，含「已删除」只读详情）：
  1. `text.ended` 分支取 `ev.text` 得 `undefined` → 助手历史全部渲染为**空气泡**（`HumanThinkPage.tsx:103-117` + `ChatMessage.tsx:33`）；
  2. 镜像里用户消息为 `type='message'` 型（`events.ts:449-454/541-549`），web 值域无此型且 `toChatItems` 无该 case → **用户历史整体丢弃**，`types.ts:396-397` 的注释「镜像不含用户消息型」与实现相悖；
  3. `permission_request`/`permission_resolved` 行取不到 `requestID`/`decision` → 生成 `unknown-${n}` **幽灵审批卡**（`action:'?'`、无资源；点击「允许一次」将 POST 到不存在的 requestID → serve 404 → 前端弹「会话在 agent 服务侧不存在」），且 `permission_resolved` 无 decision 时按 `resolveApproval(undefined, 'rejected')` **错关最近一张在审卡**，而轮询「不回退已裁决卡」使该卡无法自愈（`:155-181/187-203`）。
- 影响面：**验收 2「昨天的会话今天打开内容完整」不达**、业务规则 5「历史可查」不达（规则 5 的服务端三分语义实现正确，破在消费面）；叠加问题 2 后，聊天的「可见成果」仅存在于同一页面的实时窗口内。
- 建议（二选一，建议 ①）：① web 侧对齐包装形状（在 `humanthink.ts:getHtSession` 内解包为扁平 `HumanThinkEvent[]`（`{...e.event, seq:e.seq, timestamp:e.createdAt}`），或 `resetFromMirror` 内解包）；② server 详情改扁平返回——但会破坏 `routes/types.ts` 镜像与 server 已有测试，不推荐。同时补 web 值域 `message` 型 + `role` 处理（建议直接复用 `type:'message'` 或把 `text.ended` 的 `role` 分支扩展为 `message` 分支）。

### 4. spawn 失败路径未挂 `error` 监听 → 未捕获异常风险（连带工单功能） —— 严重程度：high

- 事实：
  - `serve-manager.ts:112-121`：`try { child = spawnFn(...) } catch { ... return false }` 后立即 `if (child.pid == null) return false;`，**`child.once('error')` 挂在 `:133-137`（pid 检查之后）**。
  - Node/libuv 的 spawn 失败真实形态：`uv_spawn` 把 exec 错误码返回给 Node（libuv 源码注释：「This runs into a nodejs issue (it expects initialized streams, even if the exec failed)」），Node 以**异步 `'error'` 事件**暴露、`child.pid` 为空 → 本实现走 pid 分支提前 return，该 ChildProcess **零 'error' 监听**，EventEmitter 对无监听的 `'error'` 抛未捕获异常（启动期即 `await humanthinkStart()`，位于 `app.listen` 之前，`index.ts:29-35`）。
  - 测试模型不符：`serve-manager.test.ts:106-119` 用「`spawnImpl` 同步 throw」模拟 ENOENT，掩盖了异步 'error' 路径。
- 影响：与问题 1 叠加时，真机每次启动都可能从「humanthink degraded」升级为「ATD 主进程启动即崩」，直接违反业务规则 7「起不来时聊天页提示服务不可用，**工单功能完全不受影响**」。即便不崩，也说明失败路径的错误处置不完整。
- 建议：把 `child.once('error'|'exit')` 前移到 pid 检查**之前**（或对 `child.pid == null` 分支同时挂 `once('error', noop)`）；测试补一条「fake spawn 返回 pid 为空的 ChildProcess 但异步 `emit('error')`」的用例，断言不抛出、走 degrade 链。

### 5. AGENTS.md 未同步 S2b1 语义 —— 严重程度：low

- 见「§7」：0 处 humanthink 命中；按先例不扣分，建议清单见末节。

### 6. `q` 检索语义宽泛 —— 严重程度：low

- `routes.ts:175-186` 的 `LIKE` 直接打在 `humanthink_events.payload`（JSON 文本）上，搜索 `user`/`type`/`text`/`pending` 等键名会命中几乎所有会话（规则 9 只要求「标题+内容关键字」）。单用户自用影响有限。
- 建议：改为对 `text`/`reasoning` 文本型行的 `json_extract(payload,'$.text')` 建条件，或接受现状并在注释记档口径。

### 7. `renderServeCommand` 导出未复用（渲染逻辑双实现） —— 严重程度：low

- worker-core 导出 `renderServeCommand`（`profile.ts:109-115`）仅被测试消费；`app.ts:198` 内联 `(profile.interactive?.serveCommand ?? DEFAULT_SERVE_COMMAND).trim().split(/\s+/)` 重复同一语义（含 `{port}` 替换在 `serve-manager.ts:104`）。建议 app.ts 直接复用导出函数（含端口替换时机的一致性）。

### 8. merge commit 使用 git 默认英文主题 —— 严重程度：low

- `9e1e879 Merge branch 'dev/feat/atd-s2b1-web' into dev/feat/atd-s2b1-humanthink`；同仓先例为中文描述式 merge（`893e053` 等），与 S3 终检同型。建议不改历史，在合入 main 的最终 merge 上落规范中文说明（审计链零扰动）。

### 9. web `HumanThinkSession` 缺 `lastActiveAt` / 事件值域缺 `message` —— 严重程度：low

- `types.ts:292-304` 缺 `lastActiveAt`（UI 未用，无害）；值域缺 `message` 已并入问题 3 的修复面，此处仅记手抄完备性；`permission_resolved.decision` 被收窄为两档（消费侧 `=== 'once'` 判定安全，无误判为 approved 的路径）。

## 非扣分观察项

- **O1（视野口径未闭环）**：`config-gen.ts:114-127` 只把 **readable 仓**写入 allow（④⑤），主仓依赖「session `directory` 内的绝对路径仍归类 `read`（命中规则③ allow `read *`）」这一二进制语义；探针 P1b 未覆盖「绝对路径读主仓」形态，冒烟脚本也只测相对/越界两态。若该形态落入 `external_directory`，规则 2 的「视野内自由」会出现假拒。建议在 `scripts/smoke-humanthink.sh` 补一句「读主仓文件的绝对路径 → 期望成功」的断言（探针同款成本，闭环规则 2）。
- **O2（seam 死置）**：`ServeManagerDeps.onReady` 注释称「事件流重订阅钩子」，装配处未接线（`app.ts:195-207`），实际重订阅由 `events.ts:138-158` 的 `streamLoop` 轮询 `deps.serve()` 承担——行为正确，建议校正注释或删除 seam（避免后人误以为重订阅依赖它）。
- **O3（对账翻页腿）**：`fake-serve.ts:167` 的 `cursor.next` 恒 null，`events.ts:417-424` 的多页循环未被覆盖；真机 message 分页是否 `next` 语义如假定（`session-facade.ts:115-125` 的不透明游标）仍待冒烟复核（探针未定形分页形态，impl 已把它列为风险项）。
- **O4（搜索排序）**：列表按 `lastActiveAt desc`；`touchSession` 只在事件落库/用户消息时更新，**不发消息的会话不会因查看而前移**（符合「活跃」语义，记档）。
- **O5（degraded 自愈面）**：退避 3 次后不再自动重试（`serve-manager.ts:172-176`），需重启 ATD 恢复——impl 定案；若与规则 6「崩溃后 ATD 自动拉起」的语义边界需用户知晓，建议并入 AGENTS.md 记档。
- **O6（共享数据目录的 saved 规则）**：D6 下 ATD serve 与自用服务同 projectID 共享 saved，D3（不开放 always）已缓解；但**用户在自用 opencode 里点过「always」**时，ATD 会话将静默继承该授权——属用户拍板接受的既有面，建议记档一句（不构成缺陷）。
- **O7（`workerId` 仅展示）**：单 serve 边界下 agent 恒为 `atd-ht-{workspaceId}`（`routes.ts:132`），会话行 `workerId` 为所选 worker 的展示/审计值；impl 技术方案 8 已记档。
- **O8（mock 保真度）**：fake-serve 未模拟 SSE 心跳注释行与 401 非 authed 态；ATD 侧解析层对注释行已有忽略分支（`events.ts:211`），风险低。
- **O9（`insertPermissionRow` 载荷形态）**：权限行以平铺 `HumanThinkEvent` 存 payload，`permission.rejected` 无 `requestID` 时不做幂等去重（探针未定形该事件载荷），残留重复行风险低。

## 修复清单（交 Builder，建议同批落）

| # | 项 | 文件 | 量级 |
|---|---|---|---|
| 1 | spawn env 合并 `process.env` | `apps/server/src/humanthink/serve-manager.ts:106-109` | 1 行 |
| 2 | spawn 失败路径挂 'error' 兜底 + 用例（pid 空 + 异步 error） | 同上 `:112-138`、`test/humanthink/serve-manager.test.ts` | 数行 + 1 用例 |
| 3 | live delta 名对齐（`text.delta`/`reasoning.delta`）+ 值域注释 | `apps/web/src/pages/HumanThinkPage.tsx:96/127`、`apps/web/src/api/types.ts:381-382` | 3 行 |
| 4 | 详情事件解包对齐（包装→扁平）+ 补 `message` 型与 role 处理 | `apps/web/src/api/humanthink.ts:78-80`（或 `HumanThinkPage.tsx:274-281`）、`api/types.ts` | 十余行 |
| 5 | 手抄完备性：`lastActiveAt`（若 UI 需展示时间）、值域补 `message` | `apps/web/src/api/types.ts` | 数行 |
| 6 | 冒烟脚本补「经 ATD API 的腿」+「绝对路径读主仓」断言（闭合问题 1 与 O1） | `scripts/smoke-humanthink.sh` | 十余行 |
| 7 | spawn 环境继承断言 | `test/humanthink/serve-manager.test.ts:28-34` | 1 行 |
| 8 | `renderServeCommand` 复用 | `apps/server/src/app.ts:198` | 1 行 |

> 修复后建议重新走本门（无需回退 spec/impl）；若调度者认为证据强度需真机闭环，可在修复后按「ATD 真机起 → 聊天页发一句 → 刷新页面 → 断言历史非空」四步补一条冒烟腿（这是本门唯一无法在 CI 内闭合的面）。

## AGENTS.md 更新建议（交付后动作，本门不扣分）

1. §一 结构树补：`apps/server/src/humanthink/`（`serve-manager`/`config-gen`/`session-facade`/`events`/`routes` 五模块）、`apps/server/drizzle/0005_s2b1_humanthink.sql`、`{dataDir}/opencode-config/opencode.json`（生成位）、`scripts/smoke-humanthink.sh`、`config.yaml` 的 `humanthinkPort`。
2. §二 新增「HumanThink 聊天（S2b1）」速查：9 端点族；事件**双通道**（live=全局 `/api/event` 单流按 sessionID 分发、delta 不落库；镜像=durable 子集落 `humanthink_events`，幂等键 `(session_id, serve_seq)`，信封缺失跳过+warn）；**恢复=重连全局流 + 活跃会话 message 对账（连接建立时触发，message 为文本权威）**；软删三分语义（列表排除 / 详情可查含内嵌历史 / 操作端点 422）；审批 once-reject 两档（`always` 不开放的原因：saved 按 projectID 与自用服务共享）；三档权限五规则 + catch-all ask 首条硬编码（**本二进制无匹配默认=allow**，探针实测）。
3. §二 状态/规则段补：视野=主仓+readable 仓、名单运行期不变（改 workspace 配置需重启）。
4. §三 spawn 坑位新增两条（本门教训）：①**spawn 必须 `env: {...process.env, ...}` 合并**——`env` 是替换语义，丢 `PATH` 时 libuv 回退 `/usr/bin:/bin`，本机 `opencode` 在 `~/.opencode/bin` → ENOENT；且失败路径须挂 `'error'` 监听（Node 的 exec 失败是异步 'error' + pid 空）；②humanthink 与自用 opencode 共享数据目录（saved 规则按 projectID 生效 → 故不开放 always）。
5. §四 约定新增：**web 手抄契约必须与 `apps/server/src/routes/types.ts` 逐字段比对**（本门三处漂移：详情 events 包装形状 / live delta 事件名 / 镜像值域 `message`），并明确「SSE 帧事件名以 server `HumanThinkEvent` 短名为准」。
6. §五 验证命令补 `bash scripts/smoke-humanthink.sh`（手动、真 serve、不进 fence）。
7. §二 或 §三 记档：serve 退避 3 次后转 degraded 不再自动重试（需重启 ATD），聊天页提示服务不可用。

## 状态落定

- 审查前实测 `.stage` = `QUALITY_GATE`（与质量门审查前状态一致）→ 本报告结论 **REJECT**，落定目标态 **`WORKING`**（builder 修复 → 重新递交）。
- 若状态机拒绝该边（或分派要求由调度者执行），则转由调度者落定；本报告技术结论不受影响。

## 结论

# REJECT

状态：QUALITY_GATE → WORKING

一句话理由：骨架与实现忠实度高（impl 1-8/D1-D8 逐项可核、五规则硬编码、幂等键与对账触发时点、软删三分语义、migration 0005、217+16+9 用例全绿），但两个接缝失守——块 1 的 serve spawn 未合并 `process.env` 使子进程无 `PATH`（libuv 回退 `/usr/bin:/bin`，本机 `opencode` 仅在 `~/.opencode/bin`）→ 真机必然 ENOENT → 三退避后永久 degraded → 9 端点全量 503，且失败路径无 `'error'` 兜底（连带工单功能风险）；块 2 手抄的事件契约三处漂移（live delta 名 `session.*.delta` vs 实际 `*.delta`、详情事件扁平 vs 包装 `{seq,serveSeq,type,event,createdAt}`、值域缺 `message`）→ 验收 1 的逐字流式恒不渲染、验收 2 的「历史完整」恒为空并伴审批卡幽灵/错关。四处修复均为局部改动（≈1 行 env + 数行契约对齐），修复后重递本门即可 —— 5/100 REJECT。
