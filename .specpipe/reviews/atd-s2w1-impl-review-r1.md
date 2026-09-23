# 审查报告: atd-s2w1-workspace — Impl (Revision 1)

- **类型**：Story Impl 完整审查（S-S8，编码前最后一道）
- **审查对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s2w1-workspace/impl.md`（v1，82 行）
- **基准**：同目录 `spec.md` v3（用户已拍板放行：FR-1~FR-6 / 兼容矩阵 4 行 / 验收场景 5 条）、`plans/agentic-ticket-desk/epic-spec.md` v4（§4.6 / §9 S2w1 行）
- **代码事实核对仓**：`/home/starlex/project/AgenticTicketDesk-s2a`（worktree @96ac11b，位于 main 合入链内；main @558de3a 已含 S2a 合并 d0290f8，二者源码同内容）
- **外部核对方式**：全文 grep 全部 `worktree.*` / `pathFor` / `reclaim` / `repoPath` / `AppRuntime` / `ERROR_STATUS` 调用面，逐点对照 `worktree.ts`、`ticket-service.ts`、`dispatcher.ts`、`app.ts`、`index.ts`、`routes/{tickets,execution,types}.ts`、`db/{schema,client}.ts`、`drizzle/*`、`test/helpers.ts`、`test/{worktree,dispatcher}.test.ts`、`tsconfig.json`、`web/src/api/*`、`web/src/pages/*`、`web/src/components/{AppLayout,CreateTicketModal}.tsx`
- **状态校验**：`stage_get('atd-s2w1-workspace')` 返回「未建档」（与 spec r2 报告同情形）——未更新状态机，状态落定由调度者执行
- **落盘说明**：报告先落 `~/doc/.specpipe/reviews/`（session 外路径不在 checker 白名单），由 Oracle 复制至仓内 `.specpipe/reviews/`
- **日期**：2026-09-23

## 总体评价

**不通过**——主骨架成立：workspace 声明式加载与 4 项校验、工单挂载 + 归属继承 + 同 workspace 约束、repoRef 建单校验 + 放行复校、worktree 去单仓化参数化（方向正确）、前端切换器/建单弹窗/三页透传、双 Builder 文件集不相交、验收场景 1-5 均有测试锚点，spec v3 的六条 FR 全部有落点。

但有 **1 处 worktree 调用面/设计缺口（high）**：`reclaim` 的唯一生产调用方是 `routes/execution.ts`（未列入任何改造行），且该路由解析 repoPath 所需的 runtime 通道未定义；`pathFor` 作为公开方法未列参数化（目录名 `{repoName}-t{id}` 显式依赖 repoPath，5 处测试调用 + 跨仓断言都靠它）；D1「调用方=dispatcher/guards」与事实不符。另有 **4 处开工前需收口的实质空白（medium）**：装配/注入面未定义（`index.ts` 缺失、buildServer/RuntimeOptions/AppRuntime/DispatcherDeps 通道未写、D2 内置 registry 的「仓根」取值未定）、测试 fixture 环境构造不明且「现有测试原样跑」不成立（helpers + 两个测试文件必然改动，tsconfig include 会强制暴露）、D3 与 §1/测试 5 口径互相矛盾（含永假 UPDATE 与 spec「日志留痕」缺失）、契约冻结三处不足使块 B 无法完全独立开发。另 5 处文档级收口（low）。均为文档级修订，预计 rev2 一小时级可完成。

## 质量评分

**58 / 100**（critical 0 / high ×1 = −12 / medium ×4 = −20 / low ×5 = −10）

## 逐维度结论

| # | 评审维度 | 结论 | 要点 |
|---|---|---|---|
| 1 | spec→impl 覆盖完整性 | 通过（有保留） | FR-1~FR-6、兼容矩阵 4 行、验收场景 5 条均有对应改造点与测试锚点（见下方覆盖核对表）；两处偏差属文档层：FR-2「日志留痕」缺失（问题 4）、上位文本漂移（问题 10） |
| 2 | 改造点可实现性（对照真实代码） | 部分通过（1 high + 1 medium） | allocate/baseline/assertReady 调用面已逐点核对（dispatcher.ts:86/89、app.ts:83/87、tests 全量）；缺口：`reclaim@routes/execution.ts:102` 与 `pathFor` 未覆盖、D1 调用方陈述有误（问题 1）、装配面未定义（问题 2）、BLOCKER 归属含糊（问题 9） |
| 3 | 双 Builder 文件集不相交 | 通过（清单不完整） | 块 A/B 无交叠；`routes/workspaces.ts` 归 A 正确；契约面以 impl §3 为唯一源。但 server 侧清单漏 4 个文件：`routes/execution.ts`、`domain/errors.ts`、`routes/types.ts`、`index.ts`（问题 1/6/7/2） |
| 4 | 契约冻结充分性（块 B 独立性） | 部分通过（1 medium） | §3 已给出 workspaces 响应形态、TicketVO 增字段、建单/列表参数扩展；但有 3 处隐含依赖块 A 的实现选择未冻结：`repos[].path` 语义、`repoRef` 缺省落库语义、`:id` 响应包裹（问题 5） |
| 5 | 测试计划可操作性（7 项） | 部分通过（1 medium） | 方向均可操作；第 5 项与 D3 冲突（问题 4）、第 6 项双仓 fixture 与第 7 项「S2a 回归 fixture」构造未写明（问题 3）、第 4 项 yaml 漂移模拟构造法未写明（问题 8） |
| 6 | 技术决策合理性（D1-D6） | 部分通过 | 见「D1-D6 速评」：D1 方向对/陈述错；D2 可行/边界未定；D3 技术可行/内部矛盾；D4 影响面小（可接受）；D5/D6 合理 |

## spec→impl 覆盖核对（FR / 兼容矩阵 / 验收场景）

| 基准项 | impl 落点 | 判定 |
|---|---|---|
| FR-1 声明式加载 | `workspaces.ts`（id kebab-case/repos id 唯一/primary 恰一/path 存在 四校验）+ `workspaces/atd.yaml` + 测试 1（含无目录启动失败与模板指引） | ✅ |
| FR-2 存量归属与兼容 | migration 0002 + D3 + 测试 5/7；建单缺省 atd；repoRef 不可变（reopen 沿用原仓，零改动确认项） | ⚠ 归属达成，但「日志留痕」缺失、测试 5 与 D3 冲突（问题 4） |
| FR-3 工单挂载 | createTicket +workspaceId（∈registry）+ parentId 强制继承（异值 422）+ addDependency 同 workspace 校验 + BLOCKER 继承 + 列表过滤 + 测试 2/3 | ✅（BLOCKER 落点表述含糊，问题 9） |
| FR-4 TASK repoRef | 建单 ∈repos（仅 TASK，缺省主仓）+ 放行复校（防 yaml 漂移）+ worktree 按 repoRef 建仓 + 测试 2/4/6 + 场景 2/3 | ⚠ 复校通道口径未定（问题 8） |
| FR-5 Workspace API | `routes/tickets.ts` ③（list + :id 含 ticketCount） | ⚠ 响应包裹形态未冻结（问题 5③） |
| FR-6 前端 | WorkspaceContext（全部=null + localStorage）+ AppLayout 切换器 + CreateTicketModal（缺省当前/全部态 atd + 目标仓下拉 + 父单过滤）+ 三页透传 + 详情/列表 Tag | ✅（Tag 显示条件依赖问题 5② 收口） |
| 兼容矩阵：仅 atd | 测试 7 + §5.3 存量验证（现有 atd.db 重启核对） | ✅ |
| 兼容矩阵：多 workspace | 测试 6（双仓真跑）+ §5.2 真跑冒烟 | ✅ |
| 兼容矩阵：yaml 非法 / 无目录 | 测试 1（启动失败信息含文件名/模板指引）+ D6 | ✅ |
| 验收场景 1-5 | §2 测试 1/2/3/6 + §5 联调锚点 2（逐条 curl+页面核对） | ✅（场景 5 展示依赖问题 5①） |

## D1-D6 速评

| 决策 | 判定 | 说明 |
|---|---|---|
| D1 参数化而非多实例 | ⚠ | 选择合理；但「调用方=dispatcher/guards」不完整——`reclaim` 的唯一生产调用方是 execution 路由（问题 1） |
| D2 registry 注入可选 | ⚠ | 思路成立（旧测试缺省 atd 合法）；但「仅含 atd（**仓根**）」的仓根取值与 `config.repoPath` 转 optional 的交互未定，且旧测试并非「零改造」（问题 2/3） |
| D3 存量归属放 migration | ⚠ | 技术可行：SQLite `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT 'atd'` 合法，存量行自动获得默认值；drizzle sqlite 兼容（先例 `0001_s2a.sql:22-23`）。但 §1 仍写 nullable、UPDATE 永假、测试 5 不可构造、spec 日志留痕缺失（问题 4） |
| D4 guards 签名扩展 | ✅ | 影响面小：`DispatchGuards` 仅 app.ts 装配（app.ts:85-88）与 service 调用点；`worktreeGuard:'skip'` 的 `() => {}` 天然兼容新签名。建议补一句「repoRef 复校先于 worktree 构造」的顺序（更指向性错误码） |
| D5「全部」视图建单缺省 atd | ✅ | 与 spec FR-6/§4 兼容矩阵一致 |
| D6 加载失败即启动失败 | ✅ | 与 spec v3 FR-1 一致（用户拍板去 default 兜底）；需同步 Epic 旧文（问题 10） |

## 发现的问题

### high

1. **worktree 去单仓化的调用面清单不完整：reclaim 的生产调用方（回收路由）未覆盖 + pathFor 未参数化 + D1 陈述与事实不符** — 严重程度：high
   - 位置：impl §1 `worktree.ts` 行 / D1 / `app.ts` 行；对照 `routes/execution.ts:102`、`worktree.ts:31-34/123-124`、`app.ts:16-23/79-98`
   - 描述：
     ① `WorktreeManager.reclaim` 的唯一生产调用方是 `DELETE /api/tickets/:id/worktree`（`routes/execution.ts:102`：`runtime.worktree.reclaim(id, keepBranch)`），该文件不在 impl 任何一行、也不在 §2 块 A 清单。签名参数化后路由必须显式解析 repoPath（`ticket.workspaceId + repoRef → registry.resolveRepo`），而 `AppRuntime`（app.ts:16-23）当前不暴露 workspace registry——「路由从哪拿 registry」在 impl 未定义；D1 却写「调用方=dispatcher/guards 已持有 ticket 上下文」，而 dispatcher 从不调用 reclaim。
     ② `pathFor(ticketId)`（worktree.ts:32-34）是公开方法，worktree 目录名 `{repoName}-t{id}` 显式依赖 repoPath；impl 参数化清单（allocate/reclaim/assertReady）未列入它，但测试有 5 处调用（`worktree.test.ts:84/94`、`dispatcher.test.ts:81/172/298`），§2 测试 6 的验收断言「worktree 目录 `{B仓basename}-t{N}`」也要靠它取路径。
   - 影响：按字面实现将出现 tsc 失败；更差的情形是 Builder 以「构造函数保留 repoPath 兜底」消错——非主仓单的回收会算到主仓路径（目录不删/分支不删，静默错仓，现有测试无覆盖）；跨仓断言则无从写起。路由级「解析 repoPath」属设计缺口，不是顺手可补的实现细节。
   - 修复建议：① §1 增 `routes/execution.ts` 行（回收前经 registry 解析 repoPath；路由经 `runtime.workspaces` 取）并明确 `AppRuntime` 新增 `workspaces: WorkspaceRegistry` 字段；② D1 改为「调用方=dispatcher（allocate）/ service guards（assertReady）/ execution 路由（reclaim），三处均持 ticket 上下文」；③ 明确 `pathFor(ticketId, repoPath)` 签名并列出测试适配点（与问题 3 合办）。

### medium

2. **生产装配与注入面未定义（index.ts 缺失 / buildServer·RuntimeOptions·AppRuntime·DispatcherDeps 通道未写 / config.repoPath 与 D2 内置 registry 的交互未定）** — 严重程度：medium
   - 位置：impl §1 `app.ts` 行、§2 块 A 清单；对照 `index.ts:7-14`、`app.ts:26-35/79-98`、`dispatcher.ts:19-29`、`config.ts:10-19/53`、`config.yaml:3`
   - 描述：
     ① workspaces 目录的**加载入口**未定义：生产侧 `repoRoot` 只在 `index.ts:8` 可得（`loadConfig(repoRoot)` / `loadRegistry(path.join(repoRoot,'workers'))` 先例），impl 未写「谁加载 workspaces、以何为基准、如何传入 `buildServer`」——`index.ts` 甚至不在改造表内；测试侧同样无注入点（`helpers.ts:44/114` 的 buildServer 调用无 workspaces 参数）。
     ② `DispatcherDeps` 是否新增 `workspaces` 字段未写；impl dispatcher 行只写「查 registry」，与既有 `registry: WorkerRegistry`（dispatcher.ts:22）同名易混。
     ③ `AppRuntime` 是否新增 `workspaces`（新路由 `GET /api/workspaces` 与回收路由都要）未写。
     ④ D2「缺省构造仅含 atd（仓根）的内置 registry」的「仓根」取值未定：`config.repoPath` 已转 optional，字段缺省时内置 atd 的仓路径无从解析；`config.yaml:3` 的 `repoPath: .` 是保留（作兜底/兼容）还是删除（双事实源收敛到 atd.yaml）也未写。
   - 影响：块 A 需自行发明装配形态（生产 + 测试两条链路），且 `config.repoPath` 与 `atd.yaml repos[].path` 可能形成两个事实源分叉。
   - 修复建议：给出装配伪码并写进 §1/§2——`const workspaces = loadWorkspaces(path.join(repoRoot,'workspaces'))`；`buildServer(db,{config,registry,workspaces})`；`RuntimeOptions.workspaces?`（缺省=内置 atd，path 取 `config.repoPath`；其缺失且未注入 → 启动失败）；`AppRuntime.workspaces`；`DispatcherDeps.workspaces`；并写明 `config.yaml` 中 repoPath 的处置（建议保留为「内置 registry 兜底来源」，注释声明 atd.yaml 为权威）。

3. **测试 fixture 环境构造未明确 +「现有测试原样跑」不成立** — 严重程度：medium
   - 位置：impl §2 块 A 第 6/7 项；对照 `test/helpers.ts:35-59/94-134`、`test/worktree.test.ts`、`test/dispatcher.test.ts:81/172/298`、`apps/server/tsconfig.json:6`
   - 描述：
     ① §2 写「现有测试在 fixture『仅 atd workspace』环境全绿（改造后原样跑）」——该环境无构造说明：`createTestContext` 用 `repoPath: tmpdir()/atd-dummy-repo`（helpers.ts:39）、`createRealContext` 用 `makeTempRepo()` 临时仓（helpers.ts:105），两者均无 workspaces 注入点；「仅 atd」究竟靠 D2 内置 registry 还是靠临时 workspaces 目录（放置指向临时仓的 atd.yaml）自洽，impl 未选边。
     ② 「原样跑」事实不成立：`tsconfig.json:6` include 了 `test`，`config.repoPath` 转 optional 后 `worktree.test.ts:22/26/51/64/96/110` 的 `git(config.repoPath, …)` 类型报错；`allocate/reclaim/pathFor` 签名变更后 `worktree.test.ts`（allocate ×7、reclaim ×2、pathFor ×2）与 `dispatcher.test.ts:81/172/298` 必然改动。「行为零回归」成立，但「文件零改动」不成立，表述会误导 Builder 低估适配范围。
     ③ 测试 6「跨仓真跑」的双仓 fixture（两个临时仓 + workspaces yaml + 注入通道 + profile 集）构造步骤未写；`{B仓basename}-t{N}` 断言取法（`path.basename(repoB)`）未写。
   - 影响：块 A 自验路径不确定；100+ 既有用例的适配范围不清。
   - 修复建议：① 写明 helpers 改造（`createRealContext`/`createTestContext` 增可选 `workspaces`/`workspacesDir`；缺省=内置 atd→`config.repoPath`）；② 列需适配的既有测试文件与断言点（worktree/dispatcher），把「原样跑」改为「行为断言不变、签名与类型适配后全绿」；③ 补双仓 fixture 构造步骤与断言取法。

4. **D3 与 §1/测试 5 口径互相矛盾 + 永假 UPDATE + spec「日志留痕」缺失 + meta 同步细节未写** — 严重程度：medium
   - 位置：impl §1 `db/schema.ts` 行（「workspaceId（text, nullable）」）与 D3（NOT NULL DEFAULT 'atd' 采用）、§2 测试 5；对照 `spec.md:32`（FR-2「一条 UPDATE + 日志留痕」）、`drizzle/0001_s2a.sql:22-23`、`drizzle/meta/_journal.json`
   - 描述：
     ① 同一文档两处口径：§1 写 nullable，D3 写 NOT NULL DEFAULT 'atd'（「采用」）。Builder 可能各取一处，导致运行时多出 NULL 分支或测试不可构造。
     ② D3「UPDATE 可省略但保留作显式归属动作」：`UPDATE … WHERE workspace_id IS NULL` 在 NOT NULL 列上恒为假（死语句）。
     ③ §2 测试 5「预置 NULL 行 → 建库迁移后归属 atd」在该列定义下**不可构造**：NOT NULL 列插不进 NULL；且 `ALTER TABLE ADD COLUMN … DEFAULT 'atd'` 对存量行自动填充，本就不产生 NULL。需两段式 fixture（先用仅含 0000+0001 的临时 migrations 目录建库插行 → 再以正式目录跑 migrate）——impl 未写。
     ④ spec FR-2 明确要求归属动作「+ 日志留痕」，D3 方案（迁移自动填充）无任何日志——机制偏离未在同处声明。
     ⑤ 0002 的 meta 同步只写了「drizzle meta 同步」四字；按 0001 先例需产出 `meta/0002_snapshot.json` + `_journal.json` idx=2 条目（`drizzle-kit generate` 默认随机 tag，需 `--name s2w1` 或事后改 journal tag——S2a 同类教训）。
   - 影响：迁移/测试/运行时三处口径不一致；审查链上留下死 SQL 与不可实现的测试项。
   - 修复建议：三处收口为一个口径（建议：列 `NOT NULL DEFAULT 'atd'`；删冗余 UPDATE，改注释说明存量行由 ADD COLUMN 默认值覆盖；测试 5 改为两段式迁移断言）；「日志留痕」或补一条启动 info（含归属行数）或在 D3 显式标注「以迁移替代、日志豁免」供用户确认；meta 同步细节写进 migration 行。

5. **契约冻结不足（块 B 独立开发的隐含依赖）** — 严重程度：medium
   - 位置：impl §3；对照 `web/src/api/types.ts:1-8`（「手抄同步」约定）、spec FR-4/FR-6
   - 描述：
     ① `repos: [{ id, path, role }]` 未定义 `path` 语义（解析后绝对路径 vs 原始声明值）。切换器要展示「显示名 · **主仓名**」且 repos 无 `name` 字段 → 只能取 path basename；若返回声明值 `.`，basename = `.`（验收场景 5 展示直接错）。
     ② `repoRef` 缺省语义未冻结：FR-4 写「缺省=主仓 id」，§3 写 `repoRef: string | null`——落库 null（读取时回退主仓）还是建单即写主仓 id，直接决定前端 Tag 显示条件（「非主仓显示目标仓名」）与块 A 复校逻辑，块 B 无法独立判定。
     ③ `GET /api/workspaces/:id` 的「200 同上单个」未写死响应包裹形态（对象本体 vs `{ workspace: … }`）；list 的 `{ workspaces: [...] }` 与前端解包需一致口径。
   - 影响：块 B 手抄 `types.ts` 时只能猜；猜错仅在运行期表现为空白/Tag 恒显或恒隐。
   - 修复建议：§3 补三句——「`path` = 服务端解析后的绝对路径（前端展示取 basename；或响应补 repo `name` 字段）」；「`repoRef` 落库：未指定为 null，展示/执行时解析为主仓；非主仓才渲染目标仓 Tag」；「`:id` 返回对象本体（与 list 元素同构）」。

### low

6. **新错误码未枚举 + `domain/errors.ts` 未列入改造点** — 严重程度：low
   - 位置：impl §1 改造表与 §3（只写「422」）；对照 `domain/errors.ts:2-35`
   - 描述：`ErrorCode` 是封闭 union、`ERROR_STATUS` 是全量 `Record`（tsc 强制同步）；未知 workspaceId / repoRef 非 TASK / repoRef ∉ repos / 跨 workspace / repoRef 复校失效等新码必须改该文件，impl 未列文件、未给码表（前端 `ApiError.code` 与测试断言均按 code）。
   - 修复建议：§1 补 `errors.ts` 行 + 建议码表（如 `WORKSPACE_UNKNOWN` / `REPO_REF_INVALID` / `REPO_REF_STALE` / `WORKSPACE_MISMATCH`，均 422），并说明与 `DAG_INVALID`/`WORKER_UNKNOWN` 的分工。

7. **`apps/server/src/routes/types.ts`（server 侧契约镜像）未列入改造点** — 严重程度：low
   - 位置：impl §1；对照 `routes/types.ts:12-17` 与 `web/src/api/types.ts:3`（「手抄同步自 apps/server/src/routes/types.ts」）
   - 描述：Ticket 增 `workspaceId/repoRef`、新增 Workspaces 响应/建单请求类型后，该镜像不改即与契约源分叉（后续 Story 按镜像手抄会漏字段）。
   - 修复建议：块 A 清单补该文件（Ticket 增两字段；新增 `WorkspaceInfo`/`WorkspacesResponse`；建单请求类型扩展）。

8. **放行复校的通道口径未定 + yaml 漂移测试构造法未写明** — 严重程度：low
   - 位置：impl §1 ticket-service ④、D4、§2 测试 4；对照 `ticket-service.ts:412-421`、`dispatcher.ts:367/438`
   - 描述：现有三件套只在 `actor==='user'` 分支执行；编排链自动放行（dispatcher.ts:438，system）与改派裁决（:367，system）不跑 guards。yaml 变更后 repoRef/workspace 漂移时，system 通道只能靠 dispatcher spawn 前解析兜底（当前语义：解析/allocate 抛错 → `preSpawnFail` → DISPATCHED→CANCELLED + system 留言；用户修 yaml 后可 reopen 恢复）——impl 未写该口径与对应用例；另测试 4「建单后 registry 变更（模拟 yaml 漂移）」未写构造法（registry 实例不可变，需同一 db 上换 registry 实例重建 service，或注入可变 registry）。
   - 修复建议：impl 写死一句「复校在 user 放行分支执行（422 REPO_REF_STALE）；system 通道以 dispatcher spawn 前解析兜底，失败沿用 preSpawnFail 语义（可 reopen 恢复）」+ 测试 4 构造法；若产品口径要求自动放行同样 422，则需在 `onTicketSettled` 前置校验并补用例。

9. **BLOCKER 继承的实现归属含糊（dispatcher vs ticket-service）** — 严重程度：low
   - 位置：impl §1 dispatcher 行第 ② 点；对照 `ticket-service.ts:469`（createBlocker 定义）、`dispatcher.ts:273/282`（两处调用）
   - 描述：要求「createBlocker 继承父单 workspaceId」却写在 dispatcher 行；createBlocker 定义在 ticket-service 且 dispatcher 有两个调用点（worker 报卡点 / 报告缺失升级）。若按字面在 dispatcher 传参，需两处分别取父单 workspace 并扩 createBlocker 入参；单点收口更稳且不会漏。
   - 修复建议：改列到 §1 ticket-service 行（createBlocker 内部读 `parent.workspaceId` 写入，一处覆盖两调用），并注明 BLOCKER 无 repoRef。

10. **上位文本漂移：Epic §4.6/§9 与 spec v3 冲突 + spec FR-3 残留 default token** — 严重程度：low
    - 位置：`epic-spec.md:122`（「无 workspaces/ 目录时自动合成 default workspace」）、`:192`（S2w1 验收③）；`spec.md:37`（FR-3「缺省=default」）
    - 描述：spec v3 已按用户拍板改为「无目录=启动失败、ATD=普通 workspace」，impl 的选择正确（与 FR-2/§4 兼容矩阵/FR-6 一致，非 SPEC_OVERTURN）；但 Epic 旧文与 spec FR-3 残留 token 未同步，S2b1（会话 cwd=workspace 主仓）若按 Epic 旧文理解会偏。
    - 修复建议：Oracle 侧同步修订 Epic §4.6/§9 与 spec FR-3 措辞（不阻塞本 impl 修订）。

## 观测（不计分，供 rev2 参考）

1. 调用面核对结论（正向）：`allocate` 生产调用仅 dispatcher.ts:86（dep `worktree: WorktreeManager` 注入，dispatcher.ts:24）；`baseline` 仅 dispatcher.ts:89；`assertReady` 仅 app.ts:87（guards 装配）；`reclaim` 见问题 1。`DispatchGuards` 仅 app.ts 装配，D4 扩展为低影响面。
2. D3 技术兼容性已实证口径：SQLite `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT 'atd'` 合法且存量行自动取默认值；drizzle 先例 `0001_s2a.sql:22-23` 即同形态（`ADD pending_label text` / `ADD round integer DEFAULT 0 NOT NULL`）。
3. 跨仓 worktree 目录名无碰撞风险：路径含全局唯一单号 `t{id}`，同一单只属一个 repoRef——「同 basename 双仓」仅在单号相同时才可能撞（不可达）。spec 边界「同仓多实例分支名碰撞」维持已知限制记档即可。
4. 若 `GET /api/workspaces` 逐 workspace 取 ticketCount，注意 N+1（本地小规模可接受，建议一条 group by 查询）。
5. spec 头部/r2 复审遗留两 low（版本标记、列表筛选器与切换器交互）已在 v3 收口（FR-6 明示「统一收口顶栏切换器」），本轮不再计。

## 结论

# REJECT

状态：IMPL_REVIEWING → IMPL_DRAFT（按 S-S8 转移表预期；注：`stage_get('atd-s2w1-workspace')` 返回未建档，无 `.stage` 可更新，落定由调度者执行）

一句话理由：骨架、FR 覆盖与双 Builder 切分成立，但 `reclaim` 的生产调用方（回收路由）未列入改造点且路由级 repoPath 解析通道未定义、`pathFor` 漏参数化（问题 1），叠加装配/注入面未定义（问题 2）、测试 fixture 与「原样跑」表述不实（问题 3）、D3 与 §1/测试 5 口径矛盾（问题 4）、契约冻结三处不足（问题 5）——建议按 1 high + 4 medium（+5 low 顺手对齐）修订后过审。

> 注：仅审文档，未修改任何代码，未触碰 `.stage`；本报告由 Oracle 复制至仓内 `.specpipe/reviews/`。
