# Epic Spec：AgenticTicketDesk——人机协作工单系统

- **topic**：agentic-ticket-desk
- **状态**：E-S3 修订 v3（按 r1 审查意见重写，待 E-S5 二审）
- **日期**：2026-09-21（v1 起草 / v2 澄清 / v3 审查修订）
- **审查记录**：r1 REJECT 62/100（6 medium + 4 low），报告 `reviews/epic-spec-review-r1.md`
- **上游调研**：pi-agent / Worker 抽象先例 / opencode headless 契约（Explorer 报告，2026-09-21，结论浓缩于 §11）

---

## 1. 愿景与定位

一句话：**人提单 → Agent 解单 → 卡点反向派给人的双向工单系统**，作为专用 CodingAgent 的编排层底座。

三条定位红线：

1. **agent 层之上的面板**——系统不 own 任何 agent，只做编排。用户自己的 agent 通过 Worker 注册协议（声明式 profile）注册为 worker 被统一调用。OpenCode 是预置 profile，不是硬编码依赖
2. **与项目无关（project-agnostic）**——任意 git 仓均可接入（M1 支持注册一个仓，架构上不绑定）
3. **单用户自用起步**——无认证、本地运行、SQLite 单文件；多用户/认证是显式非目标

## 2. 形态收敛（为什么是工单）

整个系统本质是一个工单系统：状态机 + 留言流 + 父子依赖 DAG + 结构化附件（spec 快照）。人和 Agent 互为 worker：

- Agent 的单（Story/Task）出现在人的看板
- 人的单（卡点 BLOCKER）出现在 Agent 的挂起队列，处理完关单即放行

工单是被验证 30 年的形态（Jira/GitHub Issues），人的心智模型零培训成本；「人需要懂业务原语」由工单描述语言承载。

## 3. 术语表

| 术语 | 定义 |
|---|---|
| **S1-S5** | Story 编号（本 Epic 的交付单元，见 §9 路线图） |
| **M1/M2/M3/M4** | 里程碑：M1=最小闭环（S1+S2a+S2b）/ M2=并行与分级（S3）/ M3=夜间审计（S4）/ M4=GitHub Issues 同步（本 Epic 非目标，占位后续） |
| **路由级别 L1/L2/L3** | 编排层对**卡点（异常/需决策事件）**的三级处理机制：L1=执行 worker 自决留痕 / L2=编排层规则仲裁 / L3=升级为 BLOCKER 工单给人。L1/L2 是内部决策机制，**不产生工单**；只有 L3 落为 BLOCKER 工单 |
| **pending:l3 / pending:agent** | 工单进入 BLOCKED 态时的两个标签：pending:l3=等**人**处理（L3 卡点）/ pending:agent=等**系统条件**（重试倒计时/依赖等待/超时恢复）。二者是 BLOCKED 态的子标签，与 L1/L2/L3 的映射见 §4.2 |
| **spec 快照** | 工单创建时冻结的 spec 版本；在途工单的 spec 不开缝修改 |
| **变更单** | spec 需变更时新开的工单，blockedBy 关联受影响的在途工单；旧单快照不回改，人在旧单上决定继续（按旧快照）/合并（吸收变更单）/取消 |
| **BLOCKER 单** | 卡点工单（类型 BLOCKER），blockedBy 挂在父 TASK/STORY 单上；关单时裁决：继续（父单恢复 IN_PROGRESS）/终止（父单 FAILED）/改派（父单 DISPATCHED 换 worker） |

## 4. 核心概念与领域模型

### 4.1 工单（Ticket）

| 字段域 | 内容 |
|---|---|
| 类型 | STORY / TASK / BLOCKER / DREAM（系统内部审计单） |
| 状态机 | 见 §5 |
| 父子与依赖 | parent-child + blockedBy（DAG）；子单全 DONE → 父单可推进（编排层聚合，非 DB 约束） |
| spec 快照 | 创建时冻结；变更走变更单（§3 术语表） |
| 留言流 | 人/Agent 双方留言；BLOCKER 单的留言即卡点上下文 |
| worker 绑定 | TASK/DREAM 单绑定执行 worker；STORY 纯编排不直接执行；BLOCKER 绑定人（系统内唯一"人单"） |
| commit 关联 | TASK 单完成报告强制携带 commit hash 列表，DB 关联表落库（S4 审计按此抽取 diff） |

### 4.2 卡点路由与 pending 闭环（完整机制）

```
异常/需决策事件发生（worker 报告或编排层检测）
        │
        ├─ L1 执行 worker 自决 → 留痕（工单日志），流程继续，无工单产生
        ├─ L2 编排层规则仲裁 → 调度动作（重试/换 worker/排队），无工单产生
        └─ L3 升级 → 父单转 BLOCKED(pending:l3) + 自动创建 BLOCKER 子单
                     （BLOCKER 单自包含：上下文+选项化建议+影响面）

BLOCKED(pending:agent) 的进入条件：重试倒计时 / 等待依赖单 / 临时资源不足
        │
        ├─ 条件满足 → 自动恢复 IN_PROGRESS
        └─ 重试达上限（默认 3 次，yaml 可配）→ 自动升级 pending:l3 + 生成 BLOCKER 单
                     （升级原因写入 BLOCKER：连续自愈失败）

BLOCKER 单关单人裁决：继续（父单恢复）/ 终止（父单 FAILED）/ 改派（父单 DISPATCHED）
```

要点：pending:agent 是**技术性等待**（有明确恢复条件），pending:l3 是**决策性等待**（必须人介入）；pending:agent 有重试上限，超限自动降级为 l3——不存在无限静默重试，也不存在永远无人理会的卡点。

### 4.3 HumanThink（内置聊天框）

- **本身是 Worker 能力的消费场景**：聊天框 = 某个 worker 的 interactive 模式会话（用户选择用哪个 worker 承载，如 opencode）
- 产出物：spec 草稿（会话中生成、可编辑）→ 用户点「放行提单」→ 生成工单（父子链 + spec 快照）
- 不做独立聊天系统：消息转发/事件流渲染全部走 Worker 抽象
- 会话历史 server 侧镜像（SQLite），看板可检索、换 worker 不丢历史（决策 C）

### 4.4 Worker（可插拔执行器）

**WorkerProfile（注册清单，声明式，零代码接入）**——`workers/` 目录下 yaml（决策 A）：

| 字段 | 说明 |
|---|---|
| id/名称 | 如 `opencode`、`my-claude` |
| 协议形态 | spawn-CLI（子进程 + stdout JSONL）/ attach-server（HTTP API）/ in-process（预留，pi 内建用） |
| 能力声明 | supports: interactive / task / resume / structured-output |
| 启动模板 | 命令模板，变量：worktree 路径 / agent 名 / model / session id |
| 事件流解析 | stdout/API 事件 → 统一事件流的解析声明 |
| 权限/沙箱 | 见 §6 安全底线（宿主侧强制收口） |

**WorkerRuntime（统一运行面，TS 接口）**——对齐 Vercel HarnessV1 语义子集（不直接依赖，experimental）：

- 生命周期：`doPromptTurn / doStop / doDestroy / doDetach`（park 保留 resume state）
- 事件流（命名对齐 HarnessV1，决策 B）：`text-start / text-delta / text-end`、tool 系列事件、`finish`（统一 JSONL 落盘，S4 审计与前端渲染同一份流）
- 双模式：interactive（长会话，HumanThink）/ task（一次性 + 结构化输出，解单）
- 输出契约：task 模式强制 schema 化 JSON 完成报告（含 commit 列表/卡点报告/产物清单）

### 4.5 夜间审计（dream job）

- 触发：低峰窗口（cron）+ 仓空闲判定（无 IN_PROGRESS 工单）
- 作业：specLive 比对——当日 diff（按 §4.1 commit 关联抽取）vs spec 快照，drift 三分支归因：走过放行的变更但 spec 未更新 → 自动更新 liveSpec 留痕 / 无放行记录的私改 → BLOCKER 单 / 语义歧义 → 报告单（DREAM 类型，pending:l3）
- **审计本身也是工单**（DREAM 单绑定 worker 执行比对任务）——吃自己狗粮
- 知识库沉淀：审计产出入知识库（Markdown 落盘 + 索引），消费方为后续工单的上下文注入与 spec 生成
- 熵治理自动重构为**非目标**（§13）——dream 只审计不修改

## 5. 工单状态机

```
DRAFT → SPEC_READY → DISPATCHED → IN_PROGRESS → DONE
              │           │            │
              │           │            ├─ BLOCKED(pending:l3)  ──人关 BLOCKER──→ IN_PROGRESS / FAILED / DISPATCHED(改派)
              │           │            └─ BLOCKED(pending:agent) ─条件满足──→ IN_PROGRESS
              │           │                                          └─重试超限──→ BLOCKED(pending:l3)
              │           └─ 撤回 → CANCELLED
              └─ 拒绝 → CANCELLED
任意态 → FAILED（worker 终止且不可恢复，或 BLOCKER 裁决终止）
```

- 无死锁态：BLOCKED 两标签都有出边（l3 靠人、agent 靠条件或超限升级）
- 里程碑裁剪：M1 实现 DRAFT/SPEC_READY/DISPATCHED/IN_PROGRESS/DONE/CANCELLED（BLOCKED 全套随 S3）；DREAM 态随 S4
- DISPATCHED：已选定 worker 与 worktree，尚未开始执行；IN_PROGRESS：worker 已产出首个事件

## 6. 安全底线（MUST 条款，违反即实现缺陷）

| # | 强制点 |
|---|---|
| MUST-1 | task 模式解单**必须**在独立 git worktree + 独立分支执行；无 worktree 不派发（编排层硬校验，不是约定） |
| MUST-2 | worker 执行的权限收口在**宿主侧**强制注入（如 opencode permission deny 配置），不信任 worker 自律 |
| MUST-3 | worker 终点为**本地 commit**；push 到任何远端是系统级禁用动作（未来也只经人工审批门，非本 Epic） |
| MUST-4 | worktree 生命周期由编排层独占管理（分配/回收/清理），worker 不可越界写 worktree 外路径 |
| MUST-5 | worker 进程输出全量落盘（JSONL），关单前不可清理——审计与事故溯源的最低要求 |

说明：worktree 隔离是**文件系统边界**，不是沙箱——更强的进程级沙箱（容器/Gondolin 模式）为后续增强，本 Epic 以 MUST-2 权限收口 + MUST-4 路径约束为强制底线。

## 7. 系统架构

pnpm monorepo + Node ≥22 + TypeScript：

```
apps/
  server/     Fastify + Drizzle ORM + SQLite(WAL) + node-cron
                ├─ 工单核心域（状态机/DAG 聚合/spec 快照/留言/commit 关联）
                ├─ 卡点路由（L1/L2/L3 + pending:agent 重试引擎）
                ├─ Worker Registry（workers/ yaml 加载/校验/注册表）
                ├─ Worker Runtime（生命周期/事件流/超时/日志落盘）
                ├─ worktree+分支 生命周期管理（独占）
                ├─ HumanThink 会话（消息镜像/事件流转发）
                └─ 审计 job（S4）
  web/        React + Vite + antd
                ├─ 看板（工单列表/状态流转/依赖树）
                ├─ 工单详情（spec 快照/留言流/worker 日志/commit 列表）
                ├─ HumanThink 聊天框（interactive 事件流渲染）
                └─ 卡点队列（BLOCKER 单列表/裁决操作）
packages/
  worker-core/      Worker 接口 + HarnessV1 对齐的事件流类型 + profile yaml schema
  worker-opencode/  预置 opencode profile（task: spawn `run --format json --dir <worktree>`；interactive: attach 常驻 serve + session API，决策 D）
```

## 8. （并入 §4/§9，保留编号占位避免引用断裂）

## 9. 路线图：Story 切分、依赖与验收标准

| Story | 内容 | 依赖 | 验收标准 |
|---|---|---|---|
| **S1** 核心域骨架 | 工单 CRUD/状态机（M1 裁剪版）/DAG 数据模型/留言/SQLite/API + 最小看板（列表/详情/流转/留言） | — | ① 手工建父子工单并走完 DRAFT→DONE 全程 ② 非法状态转移被 API 拒绝 ③ 留言双向可读 ④ 看板列表/详情/流转操作可用 |
| **S2a** Worker 层+解单闭环 | worker-core 接口 + Registry（yaml）+ worker-opencode task 模式 + worktree 管理 + 卡点路由骨架（L1 留痕/L3 基础版） | S1 | ① 建 TASK 单→DISPATCHED→opencode 在 worktree 解单→commit→DONE 全链 ② MUST-1/2/5 生效（无 worktree 拒派/权限注入/日志落盘）③ 完成报告 schema 化（含 commit 列表）④ worker 崩溃→FAILED 可复现 |
| **S2b** HumanThink 聊天框 | interactive 模式（attach serve）+ 消息 server 镜像 + 聊天 UI + spec 草稿生成→放行提单 | S2a | ① 聊天框选 opencode 承载，流式渲染（text-delta）② 会话历史入库可检索 ③ 会话中产出 spec 草稿并可编辑 ④ 放行→自动建单（含快照）⑤ 换 worker profile 承载新会话不丢旧历史 |
| **S3** 并行+分级路由完整版 | worktree 池 + 并发闸门 + 文件集不相交校验 + BLOCKED(pending:agent) 重试引擎（上限→升级）+ 卡点队列 UI（BLOCKER 裁决三操作） | S2a | ① 两 TASK 单并行解单互不干扰（文件集相交被拒）② pending:agent 超限自动升级 BLOCKER ③ BLOCKER 裁决继续/终止/改派三路生效 ④ 并发闸门限流可配 |
| **S4** 夜间审计 | DREAM 工单 + cron 调度 + diff 抽取（commit 关联）+ specLive 比对 + drift 三分支归因 + 知识库沉淀 | S3 | ① 定时窗口自动产出 DREAM 单并执行 ② 三分支归因各有构造用例验证 ③ 无放行记录的私改产生 BLOCKER ④ 知识库落盘可被新工单 spec 生成引用 |

依赖关系：S1 → S2a → {S2b, S3}（S2b 与 S3 互相独立，可任意顺序或并行）→ S4。

里程碑映射：**M1 = S1+S2a+S2b**（最小闭环：聊天提单→解单→关单）；**M2 = S3**；**M3 = S4**；M4（GitHub Issues 同步）非本 Epic。

## 10. Epic 级验收标准（狗粮标准）

Epic 完成的判定不是 S4 交付，而是**用本系统真实吃狗粮**：

1. 在一个真实 git 仓上，通过 HumanThink 聊天框完成一次真实小需求的「沟通→spec→放行→解单→关单」全链，全程不打开终端
2. 该过程中人为制造一个卡点，验证 BLOCKER 单→人裁决→恢复的全流程
3. 夜间审计对当次真实变更产出 drift 报告（至少验证「走过放行→liveSpec 更新」分支）
4. 上述全过程的事件流/日志/commit 关联完整可溯源

## 11. 调研支撑（Explorer 报告要点）

- **pi-agent**（earendil-works/pi，10.8 万 star，0.86.x）：SDK 库嵌入官方主路径；steering/followUp 原生支持人机协作中断-追加；JSONL 树形会话可被审计 job 消费；**风险：0.x API 不稳 + 无权限系统**（未来深度嵌入需 pin 版本 + 自带沙箱）→ 本 Epic 仅预留 in-process 协议形态位
- **Vercel HarnessV1**（@ai-sdk/harness，experimental）：已定义执行器抽象标准（生命周期/事件流/resume/detach/schema 输出/沙箱模型），官方有 opencode 与 pi 双适配器——Worker 接口语义对齐对象；不直接依赖（experimental 演进风险 + 我们只需语义子集）
- **opencode 契约无缺口**：`run --format json`（事件流输出）+ `--attach`（挂常驻 serve）+ `--dir`（指向 worktree）+ OpenAPI 生成的 TS SDK（@opencode-ai/sdk）；风险仅退出码语义未文档化（S2a 实测）
- **"OpenDesign" 查无此项目**：GitHub 同名均为设计领域项目；可插拔 worker 需求由 HarnessV1 对齐覆盖
- **背景标准**：ACP（Zed，编辑器↔agent 交互协议，acpx 无头客户端可参考）/ A2A（agent 间协作，与本场景不对口）

## 12. 决策记录（全部已定）

| # | 决策 | 来源 |
|---|---|---|
| 命名与位置 | AgenticTicketDesk，`~/project/AgenticTicketDesk` 独立仓 | 用户拍板 |
| Worker 层架构 | 抽象接口 + OpenCode 预置 profile；pi 仅预留 in-process 位（`worker-pi` 不实现） | 用户拍板 |
| HumanThink | M1 即内置聊天框（走 worker interactive） | 用户拍板 |
| 用户规模 | 单用户自用，无认证 | 用户拍板 |
| 未来演进 | pi-agent 核心内建专用 CodingAgent（调研确认可行，0.x 期 pin+隔离层） | 用户拍板 |
| A | profile 注册：项目内 `workers/` 目录 + yaml，随仓版本化 | E-S4 澄清 |
| B | 事件流命名对齐 HarnessV1（text-start/delta/end、tool 系列、finish） | E-S4 澄清 |
| C | 聊天历史 server 侧 SQLite 镜像 | E-S4 澄清 |
| D | interactive 通道 attach 常驻 opencode serve | E-S4 澄清 |
| S2 拆分 | r1 审查采纳：S2a（worker+闭环）/ S2b（聊天框）分立 | r1 审查 |

## 13. 风险

| 风险 | 缓解 |
|---|---|
| opencode V2 API 演进快（日更） | worker-opencode 单模块收口 + 版本钉死 + 升级窗口测试 |
| 聊天框与 worker 层同期交付压力 | S2a/S2b 拆分，S2b 不阻塞 S3 |
| 并行解单的仓冲突 | S3 文件集不相交校验（SpecPipe 铁律 4 同款） |
| SQLite 单文件并发写 | 单用户低并发场景够用；WAL 模式 |
| 无人值守 worker 的安全边界 | §6 MUST 条款（worktree 硬校验/宿主侧权限注入/禁 push/日志全落盘） |

## 14. 非目标（本 Epic 明确不做）

- 多用户 / 认证 / 权限模型
- GitHub Issues 双向同步（M4 占位，后续可选）
- 熵治理自动重构（dream 只审计不修改；自动改仓需护栏体系成熟后独立立项）
- 质量门 / Checker 审查环（SpecPipe 质量门模式未来作为工单类型扩展）
- worker-pi 实现（仅预留协议形态位）
- 进程级沙箱（容器/Gondolin 模式；本 Epic 底线见 §6 说明）
- UI 美化 / 移动端
