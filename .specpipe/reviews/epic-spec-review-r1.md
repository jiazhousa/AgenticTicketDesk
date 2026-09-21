# 审查报告: agentic-ticket-desk (Revision 1)

- **类型**：Epic Spec 轻量审查（E-S5，7 维度扩展）；**对象**：`/home/starlex/project/AgenticTicketDesk/.specpipe/plans/agentic-ticket-desk/epic-spec.md`（v2 / E-S4 终稿 / 175 行）
- **基准**：`templates/epic-spec-template.md`、规章 04-epic-path / 09-check-split（Epic 3 项清单：范围边界 / 致命遗漏 / Story 拆分）
- **日期**：2026-09-21

## 总体评价

不通过——定位红线、领域模型、Story 切分与调研消费成立；里程碑术语、验收标准、卡点机制语义、S2 粒度、安全强制点五处需回 E-S3 补齐。

## 质量评分

**62 / 100**（critical 0 / high 0 / medium ×6 = −30 / low ×4 = −8）

## 逐维度结论

| # | 维度 | 结论 | 要点 |
|---|------|------|------|
| 1 | 概念完整性 | 部分通过 | 工单/Worker 两层/HumanThink/dream 相互自洽；BLOCKER 单关联、「变更单」、M 里程碑术语未定义 |
| 2 | 状态机正确性 | 部分通过 | 主干可达、无死锁态；缺 pending:agent→l3 升级转移与重试上限；BLOCKED 无取消出口、FAILED 无恢复路径 |
| 3 | Story 切分 | 基本成立 | 覆盖全范围、线性依赖成立（S4 归因需 S3 的 BLOCKER 机制）；S2 过厚；缺优先级/预估 |
| 4 | 决策一致性 | 通过（1 low） | §7↔§9 无实质矛盾；仅 §3.4 事件流集合与 §9-B 命名决策不一致 |
| 5 | 调研事实消费 | 通过 | pi 风险→非目标+预留；HarnessV1→语义对齐不依赖；opencode 契约→worker-opencode 设计，均恰当 |
| 6 | 风险覆盖 | 部分通过 | 5 项风险真实；安全缓解缺强制点；自愈失控/成本风险未列 |
| 7 | 非目标边界 | 通过 | 6 条清晰、与正文一致，足以防范围蔓延 |

## 发现的问题

1. **里程碑术语 M1/M2/M3/M4 全文未定义**（6 处引用；与 S1–S4 映射不明，「M1 即内置聊天框」与聊天框落在 S2 矛盾；「交付顺序与里程碑」章节实际缺失）— 严重程度：medium
   - 影响：Story 规划期读者需猜测里程碑边界，易造成范围误判
   - 建议：统一改用 S 术语，或补 M↔S 映射表 + 交付顺序章节
2. **「验收标准」章节缺失**（模板终稿必填；全文无「验收」字样）— 严重程度：medium
   - 影响：Epic 级完成判据缺位，4 个 Story 间无对齐锚点
   - 建议：补 Epic 级验收条件（如各 Story 走完质量门 + spec/impl 归档）
3. **pending 分级双术语体系映射不明**（L1/L2/L3 与 pending:l3/agent 并列未映射；L1「留痕」载体、L2 仲裁结果未定义）— 严重程度：medium
   - 影响：「防 Issue 洪水核心机制」表述歧义，直接传导至 S3 规格
   - 建议：明示 L1→不阻塞留痕 / L2→pending:agent / L3→BLOCKER(pending:l3)
4. **卡点闭环不完备**：状态机缺 pending:agent 升级转移与重试上限；BLOCKER 单与原单的关联、执行者、关单放行语义未声明 — 严重程度：medium
   - 影响：自愈失败可无限重试（资源/成本失控）；BLOCKER 创建与回流路径不明
   - 建议：补 BLOCKED(pending:agent)→BLOCKED(pending:l3) 转移，声明重试上限与 BLOCKER 关联方式
5. **S2 过厚**（worker-core + Registry + opencode profile + worktree 管理 + attach 常驻 + 聊天框 UI + 全链闭环）— 严重程度：medium
   - 影响：体量约为兄弟 Story 的 2–3 倍，交付与审查压力集中
   - 建议：拆 S2a（worker 层 + task 闭环）/ S2b（interactive + 聊天框），或标注内部交付批次
6. **安全底线缓解缺强制机制**（worktree 隔离非沙箱；「禁 push」未声明强制点；凭据/网络边界未声明）— 严重程度：medium
   - 影响：§8 已指出 pi「无权限系统需自带沙箱」，opencode spawn 场景同构风险未落入缓解
   - 建议：Epic 级声明强制点（opencode permission 为主控、凭据隔离、是否引入 OS 沙箱/网络边界）
7. **事件流命名不一致**：§3.4 列 text-delta/tool-call/finish，§9-B 决策为 HarnessV1 四件套 — 严重程度：low
   - 影响：实现时事件类型集合需二次确认
   - 建议：§3.4 对齐 §9-B（text-start/text-delta/text-end/finish）
8. **状态机边界细节**：任意态→FAILED 过宽（DRAFT/SPEC_READY 无 worker）；BLOCKED 无取消出口；FAILED 无恢复/重派路径；S1/S2 无 BLOCKED 时 worker 卡点过渡语义未明 — 严重程度：low
   - 建议：收敛 FAILED 入口、补出口与过渡语义
9. **路线图缺优先级/预估列**（模板要求每 Story 标注优先级/依赖/预估）— 严重程度：low
   - 建议：补粗粒度预估，或明确「不预估」为用户决策
10. **数据模型预留缺口**：§3.5 diff「按工单关联 commit 抽取」但 §3.1 无 commit 关联字段；§3.1「变更单」未在类型表定义 — 严重程度：low
    - 建议：S1 建表预留关联字段，或将变更单纳入类型/流程定义

## 结论

# REJECT

一句话理由：方向、切分与调研消费成立，但里程碑术语、验收标准、卡点机制语义与安全强制点未闭合，需回 E-S3 修订后重审。

状态：EPIC_SPEC_REVIEWING → EPIC_SPEC_DRAFT
