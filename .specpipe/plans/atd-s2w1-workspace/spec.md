# S2w1：Workspace 多项目基座 — spec

- **Story**：atd-s2w1-workspace（Epic §4.6 / §9 路线图）
- **状态**：v1（2026-09-24）
- **上游依赖**：S2a（已 DONE 合 main）

## 1. 背景与目标

ATD 终态定位是**多项目迭代面板**——通过 ATD 对任意项目群（如天枢三仓）迭代，而非只开发 ATD 自身。当前为单仓模型（config.repoPath 唯一目标仓），跨仓 Story（「ontoz 修改/前端修改/后端修改并行→链路测试→MR」）无从表达。

本 Story 引入 **Workspace（工作空间）** 一等实体：项目群容器 + 仓白名单。为 S2b1（聊天框实例的可读范围注入）与 S2b2（编排 agent 跨仓拆单）提供地基。

## 2. 概念定义

| 概念 | 定义 |
|---|---|
| **Workspace** | 项目群容器：id/名称 + repos 仓列表；工单与（未来的）会话必属一个 workspace |
| **repo（仓引用）** | workspace 内的仓声明：`{id, path, role}`；**role=primary 主仓**（每 workspace 恰一个：工单缺省目标、未来 HumanThink 会话 cwd）；**role=readable 可读仓**（编排 agent 调研范围；TASK 可指定为目标） |
| **repoRef** | TASK 单的目标仓 id（建单可选指定，缺省=所属 workspace 主仓）——跨仓 Task 链的逐仓指向 |

**正交关系**：worker（工具，全局）× workspace（项目群）× repo（目标仓）——Task = 三元组定位一次执行。

## 3. 功能需求（FR）

### FR-1 Workspace 声明式加载
- `workspaces/` 目录下每 workspace 一个 yaml（与 `workers/` 对称的声明式接入，零代码）
- 字段：`id`（kebab-case 唯一）、`name`（显示名）、`repos`（列表：id/path/role；path 相对仓根目录——config.yaml 所在目录——或 `~` 展开）
- 启动时加载并校验：path 存在、primary 恰一个、repo id 在 workspace 内唯一、workspace id 全局唯一；非法声明→启动失败并指明文件与原因
- **default 恒注册兜底**：运行时 workspace 集合恒含 id=default——显式声明 id=default 者以其声明为准；否则自动合成（主仓=config.repoPath），与目录是否存在无关
- 只读来源：workspace 不经 API 增删改（改 yaml 重启生效，S2w1 不做热更新）

### FR-2 缺省 workspace 与零迁移兼容
- 无 `workspaces/` 目录（或目录为空）时：自动合成 **default workspace**（主仓=config.repoPath），日志留痕
- **DB 侧 `workspaceId` 列 NULL 语义=default workspace**（合成或显式声明 id=default 者皆可承载）：存量工单不迁移、不改行，运行时解析归属；既有 API 不传 workspace 参数时行为与 S2a 完全一致（回归保证：S2a 全部测试在无 workspaces/ 目录环境下原样通过）
- `repoRef` 建单后**不可变**（worktree/分支/日志已绑定仓；重开与改派均沿用原仓）

### FR-3 工单挂载 workspace
- 建单 API 新增可选 `workspaceId`（缺省=default；未知 id → 422 指明可选集）；STORY/TASK/BLOCKER 均挂 workspace
- **归属传播**：带 parentId 的 TASK 强制继承父单 workspace（显式传入不同值 → 422）；BLOCKER 自动创建时继承父单 workspace
- **同 workspace 约束**：parentId 边与 blockedBy 边均限同 workspace（跨 workspace 挂父子/依赖 → 422 指明两侧 workspace）
- 列表/工作台/仪表盘 API 新增可选 `workspaceId` 过滤；不传=全量（兼容）

### FR-4 TASK 目标仓 repoRef
- 建单 API（仅 TASK）新增可选 `repoRef`：必须 ∈ 所属 workspace 的 repos id，缺省=主仓 id；非法值或非 TASK 单传入 → 422 指明可选集
- **放行三件套扩展为四件套**：workerId 必填 → ∈Registry → worktree 可建 → **repoRef 仓存在且 ∈workspace**（建单时已校验，放行时复校防 yaml 变更后漂移；复校失败的在途单 → 422 指明 repoRef 已失效，人工修正 yaml 后重试或裁决终止）
- worker 执行：worktree 建在 repoRef 指向的仓；worktree 路径 `{dataDir}/worktrees/{repoName}-t{id}`（repoName 取自目标仓路径 basename——**此模板为验收锚点**：跨仓隔离以目录名可断言；分支 `atd/t{id}`、日志/prompt `t{id}.r{round}.*` 命名不变——日志按单号唯一性落盘（非按仓物理分区），跨仓隔离由 worktree 目录与分支承载）
- 约束：**同一 Story 的子 Task 可跨仓**（同 workspace 内），依赖 DAG 与编排链自动放行照常（与仓无关）

### FR-5 Workspace API
- `GET /api/workspaces`：列表（含各 workspace 的 repos 明细、主仓标识、**isDefault 标识**——前端切换器与建单缺省依赖）
- `GET /api/workspaces/:id`：详情（含该 workspace 工单计数；未知 id → 404）

### FR-6 前端
- 顶栏新增 **workspace 切换器**（下拉：显示名+主仓名；isDefault 者标注「缺省」）；切换后列表/工作台/仪表盘按所选 workspace 过滤（全局状态；「全部」选项保留，「全部」视图下建单 workspaceId 缺省=default）
- 建单弹窗（共享 CreateTicketModal）：workspace 选择后 TASK 新增**目标仓下拉**（所选 workspace 的 repos，主仓缺省标注「主」；父单候选随所选 workspace 过滤）；仅单仓 workspace 时也展示，保持一致心智
- 详情页/列表行：显示目标仓名（非主仓时醒目，主仓可省略）；列表筛选器新增 workspace 列（多 workspace 时）

## 4. 兼容矩阵（验收口径）

| 场景 | 期望 |
|---|---|
| 无 workspaces/ 目录 + 旧 config | default 合成；S2a 全链（建单/放行/执行/卡点/重开/编排链）行为不变；存量工单可见可操作 |
| 单 workspace（atd 自吃） | 与 default 等价体验；显式声明 repos |
| 多 workspace（≥2 仓） | 切换过滤正确；跨仓 TASK 各自 worktree 落对应仓；执行互不串仓 |
| yaml 非法（path 不存在/双主仓/id 重复） | 启动失败，错误信息含文件名与具体原因 |

## 5. 边界（本 Story 不做）

- workspace 热更新（改 yaml 即时生效）——重启生效
- workspace 级权限/多用户——单用户自用
- 编排 agent 可读范围注入（interactive 实例权限）——S2b1
- 知识库目录挂载——S4
- 同仓多实例分支名碰撞（`atd/t{id}` 全局单号即可撞）——已知限制记档，S2b1/S3 评估（掺 repoPath 摘要或实例前缀）
- 跨 workspace 的 Task 依赖与父子挂载——FR-3 已定义（422 拒绝），错误码细节下沉 impl

## 6. 验收场景（端到端）

1. **声明两个 workspace**（id=default 显式声明自吃 + 一个双仓测试 workspace：主=临时仓 A、readable=临时仓 B）→ 启动加载成功，GET /api/workspaces 返回两者且 isDefault 标识正确
2. 切到测试 workspace 建 TASK（repoRef=B）→ 放行 → worktree 落在仓 B 的 `{repoName}-t{N}`，执行 DONE，commit 在仓 B 分支上
3. 同 workspace 建 STORY + 跨仓 Task 链（A 仓 Task1、B 仓 Task2，两者均**预绑定 worker**，Task2 blockedBy Task1）→ Task1 DONE 后 Task2 自动放行（编排链自动流转跨仓生效），各自 worktree 独立
4. 删掉 workspaces/ 目录重启 → default 恒注册（合成），存量工单归属正确、S2a 测试套件全绿
5. 前端：切换器过滤两页一表；建单弹窗目标仓下拉缺省主仓；B 仓单详情显示目标仓名
