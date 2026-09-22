# 审查报告: atd-s1-core-domain — Impl (Revision 1)

- 类型：Story Impl 完整审查（S-S8）
- 对象：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s1-core-domain/impl.md`（114 行）
- 基准：同目录 spec.md v2（已放行；A1-A7 为唯一验收来源）、Epic spec v4（§7 技术底座 / §9 S1 行）、仓现状（全新仓：git log 仅 3 个 docs/chore 提交，除 `.specpipe/` 与 `.gitignore` 外无任何代码，与 impl 假设一致）
- 状态校验：`.stage` = IMPL_REVIEWING（与任务书一致）
- 日期：2026-09-22

## 总体评价

不通过——方向与骨架正确、A 块（后端）自洽度较高，但存在 3 处开工前需收口的实质空白（跨块 API 契约面 / A7 提示锚点 / Drizzle 迁移执行细节）+ 5 处低危补全；均为文档级修订，预计 rev2 半小时内可完成。

## 质量评分

75 / 100（critical 0 / high 0 / medium ×3 = -15 / low ×5 = -10）

## 逐维度结论

| # | 维度 | 结论 | 要点 |
|---|---|---|---|
| 1 | spec 覆盖 | 基本通过（1 medium） | A1-A6 均有实现设计与测试锚点；spec §3 领域规则（M1 六边 / 聚合门 / blockedBy 门 / DAG 自依赖与环 / 父子约束 / 冻结时点）与 §4 八端点全部落地；A7 末句「CANCELLED 子单详情提示」缺实现锚点（问题 2、5） |
| 2 | 可执行性 | 部分通过（1 medium + 1 low） | 文件集确实不相交（唯一交接面 `apps/web/package.json` 且有明确次序约定）；但 B 侧契约来源仅 spec §4（能力清单级），成功响应形态 / 请求体字段 / 状态码未锚定（问题 1）；验证命令依赖未声明的包名（问题 8） |
| 3 | 技术方案正确性 | 部分通过（1 medium + 2 low） | 状态机事务边界、错误格式、vite proxy（/api → localhost:3001）、vitest + fastify.inject 形态均合理；迁移策略未真正决策（问题 3）；submitSpec 与守卫字面矛盾（问题 4）；同步事务 / pragma / CHECK 三条注意未固化（问题 7）；错误码与全局错误处理见问题 6 |
| 4 | 工程完备 | 基本通过（1 low） | worktree 铁律（主 worktree 不动）、Builder 完成即 commit、中文终态注释均有明文；验证命令的工程细节与生成物归属未收口（问题 8） |
| 5 | 范围控制 | 通过 | 范围与 spec §2 做清单逐条对应、无蔓延；非目标重申完整；骨架 / 占位文件归属明确（packages/* 不建的隐含口径与 spec 一致） |

## 发现的问题

### medium

1. **跨块 API 契约未字段级锚定**（维度 2）— 严重程度：medium
   - 证据：impl §3 仅定错误统一格式 `{ error: { code, message, details? } }` 与少量语义补充（childrenCount/parentTitle、4 个错误码）；而成功响应包裹形态（裸数组/裸对象 vs 包一层）、请求体字段（comments 的 authorType/authorName/content 必填性、dependencies 的 blockedByTicketId 传参位、/transition 的 operator 缺省来源、PATCH 可改字段的子集语义）、HTTP 状态码（201/200/404）、列表默认排序、建单初始 status=DRAFT 均未写明。impl §5 明确「B 的 API 契约以 spec §4 为准」，而 spec §4 是能力清单级（如「建单（type/title/description/parentId）」），不含 JSON 形态。
   - 影响：A/B 两块各自发明字段与包裹形态——跨块唯一契约面处于低约束状态；联调（Oracle 收尾）期发现不一致需同时改前端 api 封装/页面与后端响应组装，两块都返工。
   - 建议：在 impl 补一节「API 契约附录」：每端点请求/响应 JSON 示例（camelCase 字段名与必填性）+ 状态码约定 + 列表排序与缺省值（初始 DRAFT、operator/author 缺省）。B 直接照抄，A 按此实现。

2. **A7 末句「CANCELLED 子单详情提示」无实现锚点**（维度 1）— 严重程度：medium
   - 证据：spec A7 末句与 §3.2「子单出现 CANCELLED 时父单详情出提示（人工裁决继续或取消，不自动阻断）」；impl 只在 §2 落了聚合门（不阻塞），§3 详情聚合字段未含任何提示信号，§4 DependencyPanel 仅「子单列表（状态角标）」、前端无对应提示元素——全文仅 §6 测试行出现「+提示」字样，无设计承载。
   - 影响：A 不确定详情该返回什么、B 不确定渲染什么，A7 该验收点大概率在质量门才暴露缺口（返工链更长）。
   - 建议：明确定义载体与文案，例如详情响应增 `hasCancelledChildren` 布尔（或子单行携带状态），前端子单区渲染警示行「存在已取消子单：可继续关单或取消父单」；并写入测试断言（A 服务层 + B 冒烟）。

3. **Drizzle migration 策略未真正决策**（维度 3）— 严重程度：medium
   - 证据：spec §8 将「Drizzle migration 策略」明确划归 impl 阶段决策；impl 仅 §1 一句「migration 一次成型」。缺三件事：① 生成侧——drizzle.config.ts / migrations 目录位置 / drizzle-kit devDependency；② 运行侧——迁移何时应用（server 启动自动 migrate 或独立脚本）；③ 测试侧——三个测试文件全部依赖 DB，vitest 的库初始化方式（:memory: + 同源迁移或建表）未声明。
   - 影响：A 单块内自选可行解（风险可控），但 Oracle 收尾「fresh clone → pnpm dev 冒烟」的可复现性无锚点；若误选 push 型流程，后续 Story（S2a 加表）与迁移归档不可复现。
   - 建议：三句话固化：产物位置（如 `apps/server/drizzle/`）、生成与应用方式（`pnpm db:generate` + 启动或脚本应用）、测试库用临时库或 :memory: 执行同一迁移。

### low

4. **submitSpec「走 1-5」与步骤 2 守卫字面矛盾；前端 DRAFT 按钮端点映射未声明**（维度 3）— 严重程度：low
   - 证据：§2 步骤 2 写「to=SPEC_READY 一律拒绝（422 USE_SPEC_ENDPOINT）」，同节 submitSpec 写「写 spec_content + 走 1-5 转 SPEC_READY」——字面互斥；§4 TransitionActions「按合法后继渲染按钮」未声明 DRAFT 的「提交 spec」映射 POST /spec、其余按钮映射 POST /transition。
   - 影响：按字面实现会令提交 spec 恒 422（api.test 可兜住，返工小）；B 若把 DRAFT→SPEC_READY 发去 /transition 同样恒 422。
   - 建议：注明「步骤 2 守卫仅对外端点生效，submitSpec 走共享转移逻辑（跳过）」+ 补一张「按钮 → 端点」小映射表。

5. **测试断言锚点未逐条收口**（维度 1）— 严重程度：low
   - 证据：A2 要求「状态不变，转移日志无记录」，§6 只写「非法转移 422」——转移日志零记录与 API 层 422 的断言位置未声明（state-machine.test.ts 为单测，API 语义应落 api.test.ts）；A4/A5 的「错误含未完成清单（details）」未声明断言；A6「PATCH 无效」的拒绝语义（422 拒绝整个 PATCH 或仅忽略字段）未定。
   - 建议：§6 表每行补一句断言要点，明确 api.test.ts 覆盖 A2（422 + transitions 零记录）。

6. **错误码清单不完整 + 全局错误处理未提**（维度 3）— 严重程度：low
   - 证据：仅 4 个错误码（INVALID_TRANSITION / USE_SPEC_ENDPOINT / BLOCKED_BY_PENDING / CHILDREN_PENDING）；PATCH 非 DRAFT、POST /spec 非 DRAFT、依赖自依赖/成环、父单非 STORY 或不存在、资源 404 等均未定码；统一错误形状需 Fastify setErrorHandler/setNotFoundHandler 承接，否则默认错误格式与约定不一致。
   - 建议：补最小错误码表 + 注明全局处理器收口。

7. **同步驱动三条技术注意未固化**（维度 3）— 严重程度：low
   - ① better-sqlite3 为同步驱动，drizzle 事务回调须保持同步（async 回调会破坏事务边界/提前提交）——impl 只写「事务内执行」；② WAL 与 foreign_keys 都需显式 pragma（SQLite FK 默认关闭，写 REFERENCES 不等于生效）；③ drizzle 的 `text({enum})` 是 TS 层收窄、不自动生成 DB 级 CHECK——§1 写了 CHECK IN，若要求 DB 层强制需迁移手写，否则明确以应用层校验兜底。
   - 建议：§1/§2 各补一句约束即可。

8. **工程执行细节未收口**（维度 4）— 严重程度：low
   - ① `pnpm -F server test` / `pnpm -F web build` 依赖两个包名恰为 server / web（impl 未声明；若命名 @atd/server 则 filter 不匹配，需 `-F ./apps/server`）；② 根 dev「并行起」的实现手段未定（concurrently 依赖归属谁）；③ B 的验证命令缺 `pnpm install` 前置（覆写 package.json 后需重装）；④ `.gitignore` 现仅一行 test-fence-reports/，node_modules / dist / *.db 等忽略规则与根 `pnpm-lock.yaml` 的归属未列入 A/B 文件集（同 worktree 首次 install 即产生）；⑤ 同 worktree 双 Builder 并行 commit 建议用显式路径（`git commit -- <paths>`）防交叉暂存。
   - 建议：收尾清单加一行「生成物与忽略规则：谁建、谁提交」，并把包名与命令写死。

## 结论

# REJECT

状态：IMPL_REVIEWING → IMPL_DRAFT

一句话理由：骨架、技术决策方向与验收主干覆盖到位，但跨块 API 契约面、A7 提示锚点、Drizzle 迁移执行细节三处实质空白会让并行两块在联调期返工——建议按上述 3 medium + 5 low 修订后过审（纯文档级修订，预计半小时内可完成 rev2）。

