# 审查报告: agentic-ticket-desk (Revision 2)

- 类型：Epic Spec 二审（r1 REJECT 后 v3 复审 + 全维度复核）
- 对象：/home/starlex/project/AgenticTicketDesk/.specpipe/plans/agentic-ticket-desk/epic-spec.md（v3，231 行）
- 基准：reviews/epic-spec-review-r1.md、templates/epic-spec-template.md、规章 04-epic-path / 09-check-split（Epic 3 项清单）
- 状态校验：.stage = EPIC_SPEC_REVIEWING（与任务书一致）
- 日期：2026-09-21

## 总体评价

通过——r1 六项 medium 中四项实质闭合、两项降级为 low 残余；四项 low 中两项闭合、两项留有残余。v3 的术语表、卡点闭环、MUST 强制表、S2 拆分与双验收体系成立。残余 1 medium（BLOCKED/BLOCKER 机制的 Story 归属自相矛盾）+ 6 low，均为归属/编号级修订，不阻塞 Story 级切分。

## 质量评分

83 / 100（critical 0 / high 0 / medium 1 项 = -5 / low 6 项 = -12）

## r1 问题闭合核对表

| # | r1 问题（严重度） | 状态 | 核对证据 |
|---|---|---|---|
| 1 | M1-M4 术语未定义（med） | 闭合 | §3 术语表逐项定义 M1-M4；§9 里程碑映射 M1=S1+S2a+S2b / M2=S3 / M3=S4；「M1 即内置聊天框」（§12）与 M1 含 S2b 自洽 |
| 2 | 验收标准缺失（med） | 闭合 | §9 增设每 Story 验收标准列（S1/S2a/S2b/S3/S4 五行齐备）；§10 Epic 级狗粮验收 4 条 |
| 3 | pending 双术语映射不明（med） | 部分闭合（降 low） | L1（不阻塞留痕、无工单）与 L3（BLOCKED pending:l3 + BLOCKER）已显式映射；L2 仍只列动作未落状态（见新 #2） |
| 4 | 卡点闭环不完备（med） | 闭合 | §3 BLOCKER 单定义（blockedBy 关联父单、关单裁决三路、执行者=人）；§4.2 重试上限默认 3 可配 → 自动升级 pending:l3 + 生成 BLOCKER；§5 补升级转移边 |
| 5 | S2 过厚（med） | 闭合 | S2a（worker 层 + task 闭环）/ S2b（interactive + 聊天框）拆分；§9 依赖含「S2b 与 S3 互相独立」；§13 增同期交付压力风险项 |
| 6 | 安全缓解缺强制点（med） | 部分闭合（降 low） | §6 MUST-1~5 强制表 + 非沙箱边界说明成立；凭据隔离/网络边界与 MUST-3 强制载体仍未点名（见新 #5） |
| 7 | 事件流命名不一致（low） | 闭合 | §4.4 事件流 = text-start / text-delta / text-end + tool 系列 + finish，与 §12-B 一致 |
| 8 | 状态机边界细节（low） | 部分闭合 | 升级/裁决转移已补；FAILED 入边、取消出口、STORY 聚合路径、BLOCKED 入边集合仍未收敛（见新 #3） |
| 9 | 路线图缺优先级/预估（low） | 未闭合 | §9 仍只有 内容/依赖/验收 三列，既未补预估也未声明「不预估」 |
| 10 | 数据模型预留缺口（low） | 闭合 | §4.1 增 commit 关联行（DB 关联表落库，S4 按此抽取）；变更单入 §3 术语表（工单类型留 Story 级落定，可接受） |

## 全维度复审

| # | 维度 | 结论 | 要点 |
|---|---|---|---|
| 1 | 概念自洽 | 通过 | 工单/Worker 两层/HumanThink/dream 互引一致（§4.3-§4.5、决策 A-D） |
| 2 | 状态机正确性 | 部分通过 | 主干可达、无死锁态（BLOCKED 两标签均有出边）；入口/出口残余见新 #3 |
| 3 | Story 拆分与验收 | 部分通过 | 粒度与依赖链（S1 → S2a → {S2b, S3} → S4）合理；S2a 卡点范围冲突见新 #1；优先级/预估见新 #4 |
| 4 | 决策一致性 | 通过 | §12 决策 A/B/C/D 与正文一致；r1 提出的事件流命名分歧已消除 |
| 5 | 调研事实消费 | 通过 | pi 风险 → 预留不实现；HarnessV1 → 语义对齐不依赖；opencode 契约 → worker-opencode 设计；无悬空引用 |
| 6 | 风险与非目标 | 通过 | §13 五项风险真实（含安全/并发/演进/交付压力）；§14 七条非目标与正文一致，防蔓延充分 |
| 7 | 范围边界 | 通过 | 三条定位红线（面板/仓无关/单用户）+ 单仓与无沙箱边界明确；仓落点见新 #6 |

## 发现的问题

1. 【新】BLOCKED/BLOCKER 机制的 Story 归属自相矛盾，且 S2a 验收无对应锚点 — medium
   - 证据：§5「M1 实现 ...（BLOCKED 全套随 S3）」；§9 S2a 范围含「卡点路由骨架（L1 留痕/L3 基础版）」，而 L3 按 §3 定义必然产出 BLOCKED(pending:l3) + BLOCKER 单；S2a 四条验收（① 全链 ② MUST-1/2/5 ③ 报告 schema ④ 崩溃→FAILED）无一条覆盖 L1/L3
   - 影响：切 S2a 规格时无法判定卡点基础机制是否纳入本 Story、验收如何锚定（S3 行又只列 pending:agent 重试引擎与卡点队列 UI）
   - 建议：统一为单读法——S2a 实现 BLOCKED(pending:l3) + BLOCKER 单创建并补验收，S3 补 pending:agent 重试引擎 + 卡点队列 UI；或明确卡点机制整体后移 S3（同时删 S2a 范围中的 L3 句）
2. 【r1-3 残余】L2 → pending:agent 映射仍未明示 — low
   - 证据：§3 声明「与 L1/L2/L3 的映射见 §4.2」，但 §4.2 中 L2 只列调度动作（重试/换 worker/排队）不落状态；pending:agent 进入条件单独成段
   - 影响：S3 规格需二次推断；「换 worker」（→ DISPATCHED）与「重试/排队」（→ pending:agent）的归属空白
   - 建议：§4.2 L2 行补一句：重试/排队 → BLOCKED(pending:agent)；换 worker → DISPATCHED
3. 【r1-8 残余】状态机入口/出口仍有未定义面 — low
   - 证据：① §5「任意态 → FAILED」含 DRAFT/SPEC_READY/CANCELLED 等无 worker 态，与括号内条件（worker 终止/BLOCKER 裁决终止）不自洽；② BLOCKED 无 → CANCELLED 出口（IN_PROGRESS 亦无）；③ FAILED 无恢复/重派路径；④ STORY「纯编排不直接执行」（§4.1）但 §5 未给 SPEC_READY → DONE 聚合路径；⑤ §4.2 pending:agent 条件含「等待依赖单/临时资源不足」，§5 图中 BLOCKED 仅自 IN_PROGRESS 进入
   - 影响：S1（状态机）与 S3（重试引擎）规格需自行裁决
   - 建议：收敛 FAILED 入边；补取消出口或显式声明不可取消；声明 STORY 聚合路径与 BLOCKED 入边集合
4. 【r1-9 未闭合】路线图仍缺优先级/预估列 — low
   - 建议：补粗粒度预估与优先级，或显式声明「本项目不预估」为用户决策
5. 【r1-6 残余】安全强制点残余 — low
   - 证据：MUST-3 未点名强制载体（应显式由 MUST-2 宿主侧 permission deny 覆盖 git push 与远端凭据）；凭据隔离与网络边界未入 MUST 表；S2a 验收仅引 MUST-1/2/5，MUST-3/4 无验收锚点
   - 建议：MUST-3 注明载体；S2a 验收扩为 MUST-1~5
6. 【新】「仓」维度无落点 — low
   - 证据：§1 定位称「M1 支持注册一个仓」，但 §4 领域模型无仓实体（工单无仓字段）、§7 无仓注册组件、§9 无 Story 归属；而 MUST-1 的 worktree 管理依赖目标仓来源
   - 建议：Epic 级声明仓注册载体（M1 单仓，建议 yaml 配置或界面二选一）并挂入 S2a 范围
7. 【新】文档引用与编号小疵 — low
   - 证据：§4.5「熵治理自动重构为非目标（§13）」应为 §14；§3 术语「S1-S5」与实际编号 S1/S2a/S2b/S3/S4 不符；§5「DREAM 态随 S4」混用类型（§4.1）与状态
   - 建议：随本轮修订一次性订正

## 结论

# PASS

一句话理由：r1 主要问题已实质闭合（4/6 medium 闭合、2 项降级为 low），残余 1 medium + 6 low 均为归属与编号级修订，不影响按 §9 切出合格 Story 级 spec。

状态：EPIC_SPEC_REVIEWING → EPIC_SPEC_USER_AUDIT
