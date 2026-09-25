# Spec: S3 并行执行与 pending:agent 自愈引擎

- **topic**：atd-s3-parallel-retry
- **状态**：v1 草案（SPEC_DRAFT）
- **日期**：2026-09-25
- **上游**：Epic `agentic-ticket-desk` §4.2/§9（S3 行）；S2a/S2w1 已交付

## 背景

S2a/S2w1 交付了单发执行闭环：每个 TASK 放行即 spawn，settle 判定后终态或重开。当前缺口：多单同时放行时进程层面天然并行，但**无治理**——同仓并发 git 操作无闸门、并行单可能改同一批文件无校验；L2 重试（报告缺失/schema 错）是立即原地 round+1，无倒计时/排队/上限升级机制；Epic §4.2 的 `BLOCKED(pending:agent)` 完整闭环（技术性等待→自动恢复→超限升级 l3）未落地。

## 目标

给执行面加三层治理，让人可以放心同时放行多个 TASK：

1. **文件集不相交校验**——并行执行的前置防线（SpecPipe 铁律 4 同款语义）
2. **并发闸门**——per-repo 限流，超限排队而非并发竞争
3. **pending:agent 自愈引擎**——技术性等待有明确的自动恢复条件与重试上限，超限自动升级为人裁决的 l3 卡点

## 范围

**做**：

- `plannedFiles` 声明：TASK 提交 spec 时可选结构化字段（相对 repoRef 的路径列表，支持目录前缀 `dir/` 语义）；随快照冻结
- 放行时校验：同 repo（workspace+repoRef 定位）下处于 DISPATCHED/IN_PROGRESS/pending:agent 排队中的工单，plannedFiles 两两不相交（目录前缀含叠）；**user 通道相交 → 422 FILE_SET_CONFLICT 拒绝放行；编排链自动放行相交 → 排队 pending:agent**（原因=文件集冲突），前单落定后重校验
- 并发闸门：per-repo `maxConcurrentPerRepo`（config.yaml，默认 2）——同仓 DISPATCHED+IN_PROGRESS 计数达限即排队 pending:agent（FIFO）
- `BLOCKED(pending:agent)` 引擎：进入原因三类（闸门排队/文件集冲突排队/重试倒计时）；恢复=统一走 BLOCKED→DISPATCHED 重新放行校验链；`maxRetries`（默认 3，可配）超限 → 自动升级 BLOCKED(pending:l3)（blockReason 记录自愈失败链）
- 重试改造：报告缺失/schema 错的重试从「立即」改为「倒计时」`retryBackoffSec`（默认 60s，固定间隔）；重启恢复（启动扫描 pending:agent 重建计时器）
- 卡点队列 UI：工作台/列表的 BLOCKED 区分 pending:l3（可裁决三选）与 pending:agent（只读：原因/重试次数/下次唤醒倒计时）
- DB migration 0004：tickets +`retry_count`（INTEGER NOT NULL DEFAULT 0）+`retry_at`（INTEGER，epoch 秒，可空）

**不做**：

- 依赖等待不转 pending:agent——维持已交付的 SPEC_READY 语义（见待澄清 1）
- 崩溃/超时重试——维持 S2a 的 FAILED 直接终态语义
- worktree 预建池化（「worktree 池」实为多 worktree 并存管理，allocate 复用逻辑 S2a 已有）
- plannedFiles 的 glob/通配匹配（MVP：精确路径+目录前缀）
- settle 后实测 touched files 的交叉审计（归 S4 夜间审计消费）

## 验收标准（初版）

1. **并行隔离**：两 TASK（plannedFiles 不相交）同时放行真跑，各自 worktree/分支/日志/commit 互不干扰
2. **相交拒绝**：同仓两 TASK plannedFiles 相交 → user 放行 422 FILE_SET_CONFLICT；同为编排链自动放行 → 后者排队 pending:agent（blockReason=文件集冲突），前者 DONE 后后者自动放行执行
3. **闸门限流**：`maxConcurrentPerRepo=1` 下第二单排队 pending:agent，第一单 settle 后自动恢复执行
4. **重试倒计时**：报告缺失 → BLOCKED(pending:agent)（retry_at=now+backoff）→ 到点自动 round+1 重跑；连续失败达 maxRetries → 自动升级 BLOCKED(pending:l3)，blockReason 含历次失败摘要
5. **重启恢复**：pending:agent 在途单经 server 重启后计时器重建、到点照常恢复
6. **卡点队列**：工作台 BLOCKED 区 l3/agent 分区正确；agent 卡展示原因/次数/倒计时且不出现裁决按钮
7. **零回归**：无 plannedFiles 的存量单不参与文件集校验、行为不变；fence 全绿
8. Epic §9 S3 验收三条（①并行互不干扰②pending:agent 超限自动升级③闸门可配）分别被 1/4/3 覆盖

## 待澄清

1. **依赖等待的形态**：Epic §4.2 字面将「等待依赖单」列为 pending:agent 进入条件；S2a 实现为 SPEC_READY 挂起+自动放行（F1/F4 已交付）。建议**维持现状**（未放行≠执行中受阻，语义更干净、看板噪音更少），即对 Epic §4.2 做显式收紧——请拍板
2. **瞬时 preSpawnFail 是否纳入重试**：当前 spawn 前置失败落 CANCELLED（终态）。瞬时性失败（git 锁竞争/EAGAIN）转 pending:agent 重试更自愈，确定性失败（配置漂移）维持 CANCELLED——但失败分类在 spawn 链路里不总是可判。建议 MVP 全部维持 CANCELLED，S3 不动——请拍板
3. **plannedFiles 声明入口**：建议 submitSpec 请求体可选字段（随快照冻结，DRAFT 可改）；建单时声明太早（spec 还没写）
4. **退避策略**：固定间隔 60s vs 指数退避（60/120/240）——建议 MVP 固定，YAGNI
