# 审查报告: atd-s1-core-domain (Revision 1)

- 类型：Story Spec 轻量审查（S-S5）
- 对象：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/atd-s1-core-domain/spec.md`（v1，106 行）
- 基准：Epic spec v4（§9 S1 行 / §4 领域模型 / §5 状态机）、`templates/review-spec-template.md`
- 状态校验：`.stage` = SPEC_REVIEWING（与任务书一致）
- 日期：2026-09-22

## 总体评价

通过——范围严格对位 Epic §9 S1 行，M1 六态 6 条边与 Epic §5 裁剪版逐条一致，验收主干（全链/非法转移/聚合/依赖/冻结/留言/时间线）可测，非目标边界足以防蔓延；1 medium + 5 low 属局部补全，不阻塞 Story 切分与 impl 方向。

## 质量评分

85 / 100（critical 0 / high 0 / medium ×1 = -5 / low ×5 = -10）

## 逐维度结论

| # | 维度 | 结论 | 要点 |
|---|------|------|------|
| 1 | 与 Epic 一致性 | 通过（1 low） | 范围=Epic §9 S1 行；M1 边集逐条核对一致（DRAFT→SPEC_READY / SPEC_READY→DISPATCHED / SPEC_READY→CANCELLED / DISPATCHED→IN_PROGRESS / DISPATCHED→CANCELLED / IN_PROGRESS→DONE，无多边少边）；类型枚举一次建齐、workerId/authorType 预留语义对齐 §4.1；冻结时点口径差见 #5 |
| 2 | 完备性 | 部分通过 | A1-A6 可测且覆盖主干路径；specContent 编辑通道缺口见 #1，CANCELLED 边未入验收见 #4 |
| 3 | 一致性内检 | 部分通过 | §3.1/§5 与 §4 PATCH 行矛盾（#1）；CANCELLED 子单与父单 DONE 门的组合语义未闭合（#2） |
| 4 | 边界清晰 | 通过（1 low） | 非目标覆盖 S2a/S2b/S3/S4 且与做清单互斥；DAG 完整性校验缺口见 #3 |

## 发现的问题

1. **spec 提交/编辑通道不自洽（§3.1、§5、A6 vs §4）** — 严重程度：medium
   - 证据：§3.1 与 §5 均声明 specContent「DRAFT 期可编辑」，但 §4 PATCH 行仅列 title/description，无 specContent 编辑通道；A6 引用的「PATCH spec」无对应端点，且「无效」语义未定（422 拒绝 or 静默忽略）；DRAFT→SPEC_READY 可经 /transition 绕过 /spec 跳过快照写入，两端点职责未划分
   - 影响：核心交付项（spec 快照）的实现无唯一答案；A6 不可执行
   - 建议：统一语义——DRAFT 态允许编辑 specContent（扩展 PATCH 或独立端点）；DRAFT→SPEC_READY 仅允许经 POST /spec（/transition 对其 422）；A6 改为可执行表述（如「SPEC_READY 后改 specContent 返回 422」）
2. **CANCELLED 子单与父单 DONE 门的组合语义未闭合** — 严重程度：low
   - 证据：既声明「子单未全 DONE → 父单 DONE 被拒（列未完成子单）」，又声明「子单 CANCELLED → 人工裁决继续或取消，不自动阻断」；「继续」路径在字面门下仍无法关单
   - 影响：实现需自行裁决（严格门=含取消子单的 STORY 永不可关；宽松门与 A4 冲突）
   - 建议：明确 CANCELLED 子单是否计入「未完成」；若允许人工确认后关单，补该语义
3. **DAG 完整性校验未定义** — 严重程度：low
   - 证据：§3.3 仅定义放行前置门，无自依赖/环校验；父子层级约束（TASK 可否有子单、可挂哪些类型）未声明
   - 影响：可构造 A↔B 依赖环致双方均无法 DISPATCHED（可手动删边恢复）；与 Epic「DAG 数据模型」措辞有落差
   - 建议：补校验规则（自依赖/环拒绝，422）并入验收
4. **验收未覆盖 CANCELLED 两条边与终态不可逆** — 严重程度：low
   - 证据：A1 仅走主干 4 条边；SPEC_READY→CANCELLED（拒绝）/ DISPATCHED→CANCELLED（撤回）及 DONE/CANCELLED 无出边未入验收
   - 建议：补 1 条验收（拒绝/撤回可取消；终态拒绝一切转移）
5. **冻结时点与 Epic 字面口径不一致** — 严重程度：low
   - 证据：Epic §3/§4.1 为「创建时冻结」；Story 定义为 SPEC_READY 时冻结、DRAFT 可编辑（解释更贴合 M1 流程，功能无冲突）
   - 影响：术语口径分叉，后续 Story 引用易歧义
   - 建议：对齐一处（改 Epic 措辞或在 Story 显式注明为 S1 解释）
6. **「CRUD」与无删除端点口径未注明** — 严重程度：low
   - 证据：§2 交付项写「工单实体：CRUD」，§4 无删除端点，亦未声明「取消即终态、无物理删除」
   - 建议：注明口径（取消即终态），或将物理删除列入非目标

## 结论

# PASS

一句话理由：范围、M1 边集与预留语义均与 Epic 对位，验收主干可测；1 medium（spec 编辑通道不自洽）+ 5 low 属局部补全，建议在用户放行前顺手修订 #1 以保证 impl 无歧义。

状态：SPEC_REVIEWING → SPEC_USER_AUDIT
