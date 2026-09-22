# 审查报告: atd-s1-core-domain — Impl (Revision 2)

- 类型：Story Impl 完整审查（S-S8，二轮）
- 对象：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s1-core-domain/impl.md`（v2，166 行）
- 基准：同目录 `spec.md` v2（已放行，A1-A7 唯一验收来源）、`plans/agentic-ticket-desk/epic-spec.md` v4（§7 技术底座 / §9 S1 行）、r1 报告 `atd-s1-impl-review-r1.md`、仓现状（git status：仍无 `apps/` 代码，仅 `.specpipe/` + `.gitignore`，与「impl 过审后编码」一致）
- 状态校验：`.stage` = IMPL_REVIEWING（与任务书一致）
- 日期：2026-09-22

## 总体评价

通过——r1 的 3 medium + 5 low 已获实质修复（非加字）：§3 升级为全 8 端点字段级契约、A7 提示锚点（hasCancelledChildren → Alert → 测试）闭环、migration 生成/应用/测试三侧决策落定；A1-A7 全部有实现锚点、测试断言与冒烟项，两 Builder 文件集不相交且命令写死。剩余 4 处 low 均为文档级收口（不阻塞开工），建议派发时顺手对齐。

## 质量评分

92 / 100（critical 0 / high 0 / medium 0 / low ×4 = -8）

## r1 问题闭合核对

| r1 # | 问题 | 闭合判定 | v2 证据（要点） |
|---|---|---|---|
| M1 | 跨块 API 契约未字段级锚定 | 闭合（残留 3 小项 → 新 L1） | §3.1-3.8 全端点给出 req/res/状态码：包裹形态（成功=资源本体、失败=`{error:{code,message,details?}}`）、201/200/204、Ticket camelCase 字段全集、operator/authorType/authorName 缺省、types.ts 位置（B 抄不引） |
| M2 | A7 CANCELLED 提示无实现锚点 | 闭合 | §3.3 详情响应增 `hasCancelledChildren`；§4 详情页顶部 antd Alert「存在已取消子单，请裁决」；§6 断言 hasCancelledChildren=true【A4/A7】；§7 冒烟项「CANCELLED 告警」 |
| M3 | migration 策略未真正决策 | 闭合 | §0：drizzle-kit generate 产物进仓 `apps/server/drizzle/*.sql` + server 启动 `migrate()` 自动执行 + 测试库用同一套 migration（每测试文件独立内存实例）——生成侧/运行侧/测试侧三问齐答 |
| L4 | submitSpec 字面矛盾 + DRAFT 按钮映射 | 闭合 | §2.3「独立路径，不经 transition()」并给出完整步骤；§4「DRAFT→『提交 spec』（POST /spec，非 transition）」 |
| L5 | 测试断言锚点未收口 | 闭合 | §6 逐行断言：非法转移「transitions 表零新增」【A2】、details 列出未完成子单 id【A4/A5】、api.test 断言 422 体 error.code/message/details【A2】、PATCH 拒绝语义=422 且字段未变【A6】 |
| L6 | 错误码清单不完整 + 全局错误处理 | 基本闭合（残留 → L2） | §2.4 九个错误码全集 + `setErrorHandler` 统一包裹；残留 CYCLE/DAG_INVALID 语义重叠等 |
| L7 | 同步驱动三注意未固化 | 闭合 | §0 三条铁则：事务回调只写同步代码 / PRAGMA WAL+foreign_keys / text 枚举无 DB CHECK（以 zod 兜底，§1 已不再声称 DB CHECK） |
| L8 | 工程执行细节未收口 | 基本闭合（残留 → L3） | 包名 `@atd/*` 写死且命令用包名过滤；根 dev=`pnpm --parallel --filter "./apps/*" dev`（不引 concurrently）；B 命令补 `pnpm install`；`.gitignore`/占位/lockfile 归属 + 显式路径圈定 commit 纪律；残留 package.json/lockfile 提交时序（→L3） |

## 逐维度结论

| # | 维度 | 结论 | 要点 |
|---|---|---|---|
| 1 | spec 覆盖 | 通过 | A1-A7 逐条有实现+测试+冒烟锚点；spec §3 领域规则（六边白名单/聚合门/blockedBy 门/DAG 自依赖与环/父子约束/冻结时点）全落地；终态无出边与 A7 尾部提示均有承载 |
| 2 | 可执行性 | 通过（残留 L1/L3/L4） | 文件集不相交成立（唯一交接面 apps/web/package.json 有次序口径）；契约字段级、双块验证命令明确；Builder 零歧义执行与验收映射成立 |
| 3 | 技术正确性 | 通过（残留 L2） | 事务边界（同步回调）、错误分流（404/400/422）、migration 三侧、vite proxy（→3001）、vitest+fastify.inject 内存库形态均成立；DAG 检测方向（沿 blockedBy DFS）与 spec 语义一致 |
| 4 | 工程完备 | 通过（残留 L3） | worktree 铁律（主 worktree 不动）、完成即 commit、中文终态注释、收尾统一验证（install+test+build+dev 冒烟）齐全 |
| 5 | 范围控制 | 通过 | 与 spec §2 做/不做逐条对应、无蔓延；非目标重申完整；BLOCKER/DREAM 仅建枚举、不开放创建，与 spec 一致 |

## 发现的问题（v2 新残留，均为 low）

### low

1. **§3 契约残留三小项** — 严重程度：low
   - ① 列表端点默认排序未声明（r1 明示建议项之一）；
   - ② POST /api/tickets 的初始 status=DRAFT 未字面写死（可由 A1 链与 /spec 的 DRAFT 前置推断，非锚定）；
   - ③ `Comment/Transition` 以「同 §1 字段」引用，而 §1 是 SQL snake_case 列名、§3 其余处（Ticket）为 camelCase——B 手抄 types.ts 有 snake/camel 误配面（错配仅会在运行期/冒烟以字段空白暴露）。
   - 影响：不阻塞实现；均为低成本收口。
   - 建议：§3 末尾补三行——列表排序（如 `ORDER BY id DESC`）、「创建初始 status=DRAFT」、Comment/Transition 的 camelCase 字段清单。

2. **错误码语义三处未收口** — 严重程度：low
   - ① §2.4 同时列出 `DAG_INVALID`（注释含「环」）与 `CYCLE`（无注释）——依赖成环该用哪个码未定；§3.8 只写「失败 422」；
   - ② §6「transition(to=SPEC_READY) → 422 USE_SPEC_ENDPOINT」未声明来源态——从 DRAFT 发起才命中 §2.2 步骤 3；从 SPEC_READY 等态发起会先在步骤 2 落 INVALID_TRANSITION（测试用例来源态需写死，否则可能写出误预期）；
   - ③ blockedBy 目标单不存在时的错误码未注明（NOT_FOUND vs DAG_INVALID）。
   - 影响：前端仅 toast message，不影响验收；多码同义削弱 API 一致性，并给测试埋歧义。
   - 建议：删 CYCLE 并入 DAG_INVALID（或注明分工）；§6 该行注「自 DRAFT 发起」；§3.8 明确不存在码。

3. **共享产物提交时序仍有交叉面** — 严重程度：low
   - ① `apps/web/package.json` 由 B 全量覆写、却归 A 的 commit 提交——未规定「A 提交须晚于 B 覆写」。若 A 先完成并提交，仓内落的是「最小占位」，B 的覆写滞留工作区（fresh clone 复现 web 构建失败）；
   - ② `pnpm-lock.yaml` 归 A，但 B 覆写 package.json 后的 `pnpm install` 会再次改写 lockfile，而 B 的提交清单不含根文件——最终 lockfile 可能不含 web 依赖；
   - ③ 两 Builder 同 worktree 各自 `pnpm install` 存在并发写 node_modules/lockfile 的竞争面（未规定串行）。
   - 影响：功能与验收不阻塞（Oracle 收尾 install 兜底、冒烟照跑），但分支 commit 完整性/可复现性有洞，「commit 纪律」声称的闭环未真正闭合。
   - 建议：二选一并写进 §5/§7——(a) package.json 改由 B 提交（撤回「归 A」）；或 (b) Oracle 收尾加「`git status` 干净检查 + 补提交 + fresh-clone 复验」，安装串行（B 先、A 后）。

4. **§6 测试清单端点覆盖缺口** — 严重程度：low
   - PATCH 仅有拒绝路径（NOT_DRAFT），成功路径（DRAFT 改 title/description/specContent）无测试行；DELETE /api/tickets/:id/dependencies 无测试行——而 §3.8 交付该端点、UI DependencyPanel 增删依赖依赖它。
   - 影响：冒烟可兜底；但质量门「新增测试已实现」以本清单为核对基准，缺行即缺口。
   - 建议：api.test.ts 补「PATCH 成功更新 DRAFT 字段」「DELETE 依赖 204」两例。

## 结论

# PASS

状态：IMPL_REVIEWING → IMPL_APPROVED

一句话理由：r1 的 3 medium（契约字段级/A7 锚点/migration 决策）与 5 low 已实质修复、A1-A7 全锚点且双 Builder 契约面闭合，残留 4 处 low 均为不阻塞开工的文档级收口——建议派发时顺手对齐 L1-L4（尤其 L3 提交时序）。
