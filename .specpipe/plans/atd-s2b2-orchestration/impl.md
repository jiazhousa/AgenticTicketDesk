# Impl: S2b2 编排助手拆单链

- **topic**：atd-s2b2-orchestration
- **上游 spec**：`.specpipe/plans/atd-s2b2-orchestration/spec.md`（v3.1，SPEC_APPROVED——业务语言版，技术细节以本文档为唯一事实源）
- **基线**：main@d1c9dd9
- **依赖事实**：S2b1（动态 agent 配置/事件镜像/聊天流渲染）、S3（plannedFiles 冻结与校验/排队/自动流转）、既有域（STORY 聚合/依赖 DAG/四件套）

## 技术方案

1. **产出合同（系统提示注入）**：config-gen 为 `atd-ht-{ws}` 增 `system` 字段（`ConfigAgent.Info.system` 可选字段，app 侧注入生效——S2b2 spec r1 已核）。模板含：双职责声明（用户明确要求拆单/提单时才进入编排）、调研先行、**业务语言要求（spec 不含技术实现细节）**、计划块格式范例、字段说明（局部 id/dependsOn 引用/repoRef 取值域/workerId 取值域/plannedFiles 尾斜杠语义）、**动态注入**：该 workspace 的 repos 清单与全局可用 workers 清单（启动期快照，与 serve 生命周期一致）
2. **计划块协议**：助手在回复中输出 fenced 块 ```atd-plan + JSON：
   `{"story":{"title","description"},"tasks":[{"id":"t1","title","spec","repoRef?","workerId","dependsOn":[],"plannedFiles?":[]}]}`——id 为计划内局部短 id；repoRef 缺省=主仓 id
3. **web 解析与渲染**：ChatMessage 渲染 assistant 文本前提取 ```atd-plan 块（正则+JSON.parse；失败降级原样文本）；块成功解析→渲染 PlanCard，块外文本照常 markdown；PlanCard 本地编辑态（刷新回原稿，spec 规则 9）
4. **校验单源**（server `humanthink/plan.ts`）：validate 与 confirm 共用——workspaceId 取会话归属；repoRef ∈ 该 workspace repos（缺省 primary）；workerId ∈ Registry 且可用；局部 id 唯一；dependsOn ⊆ 本计划 id 集+拓扑无环；plannedFiles 形态（相对路径/尾斜杠目录）；返回 `issues:[{taskId?, field, message}]`（空=通过）
5. **原子建单**（confirm）：`db.transaction` 内——建 STORY（workspaceId=会话 ws，description=story.description）→ 逐任务建 TASK（DRAFT，parentId=story，repoRef 落库实际值，workerId 预绑定）→ addDependency（局部 id→真实 id 映射）→ 逐任务 submitSpec（specContent=task.spec + plannedFiles 冻结）；**事务提交后**触发根任务放行（见 6）；返回 `{story:{id}, tasks:[{localId,id}]}`
6. **根任务放行触发**（spec 规则 6 新入口）：dispatcher 将既有 onTicketSettled 内的「下游自动放行」核心提取为独立方法 `releaseChainReady(storyId)`（无依赖+SPEC_READY+预绑定 → actor=system 走完整放行前置链——闸门满/文件冲突自动落 S3 排队语义，无失败面）；confirm 事务提交后调用；既有 onTicketSettled 改调提取后的方法（行为不变）
7. **跳转**：confirm 成功 → web 跳 STORY 详情页（泳道即有）

## 改动点

### 块 1：server

| 文件 | 改动 |
|---|---|
| `apps/server/src/humanthink/plan.ts`（新） | PlanPayload zod schema（含局部 id/依赖/文件集形态）；校验函数（技术方案 4，单源）；confirm 编排（技术方案 5，事务+放行触发+返回映射） |
| `apps/server/src/humanthink/routes.ts` | +`POST .../:id/plan/validate` → `{issues:[]}`（200 恒定）；+`POST .../:id/plan/confirm` → `{story, tasks}` 或 422（issues 回传，建单未发生） |
| `apps/server/src/humanthink/config-gen.ts` | atd-ht-{ws} 增 `system`（产出合同模板+动态 repos/workers 清单注入——技术方案 1）；模板为纯函数可单测（快照断言） |
| `apps/server/src/dispatcher.ts` | 下游放行核心提取 `releaseChainReady(storyId)`（签名以现状为准）；onTicketSettled 改调（行为不变）；confirm 经 humanthink 模块回调触发（装配沿用 service/dispatcher 现有引用通道——plan.ts 持 dispatcher 引用经 AppRuntime） |
| `apps/server/src/routes/types.ts` | 契约镜像：PlanPayload/PlanIssue/PlanValidateResponse/PlanConfirmResponse |
| `apps/server/test/humanthink/plan.test.ts`（新） | 校验单源全规则（repoRef 越界/worker 不可用/id 重复/跨计划依赖/环/文件集形态）；confirm 原子性（中途失败全回滚——mock addDependency 抛错断言零残留）；confirm 后根任务放行触发（无依赖任务 DISPATCHED，有依赖任务 SPEC_READY）；排队语义衔接（闸门满→根任务排队非失败）；跨仓（repoRef=readable 落库正确） |
| `apps/server/test/humanthink/config-gen.test.ts` | +system 产出合同快照（模板含 repos/workers 动态段/atd-plan 格式范例/业务语言要求） |

**块 1 最小验证**：`pnpm -F @atd/server exec tsc --noEmit && pnpm -F @atd/server test`

### 块 2：web

| 文件 | 改动 |
|---|---|
| `apps/web/src/components/chat/PlanCard.tsx`（新） | 计划卡：story 标题/描述编辑；任务卡增删（title/spec 文本域、repoRef Select=会话 workspace repos、workerId Select=available workers、dependsOn 多选=计划内局部 id、plannedFiles 文本域每行一路径）；预检按钮（validate→违规项标红至对应任务字段）；确认按钮（confirm→成功跳 `/tickets/:storyId`）；编辑态本地（刷新回原稿） |
| `apps/web/src/components/chat/ChatMessage.tsx` | assistant 文本渲染前提取 atd-plan 块（技术方案 3）——提取成功传 PlanCard，块外文本照常 markdown |
| `apps/web/src/pages/HumanThinkPage.tsx` | PlanCard 确认成功回调（navigate STORY 详情）；校验状态透传 |
| `apps/web/src/api/humanthink.ts` | +validatePlan/confirmPlan 两端点 |
| `apps/web/src/api/types.ts` | 手抄 PlanPayload/PlanIssue/响应型（对齐 routes/types.ts 镜像逐字段） |

**块 2 最小验证**：`pnpm -F @atd/web build`

## API 契约冻结（块 2 并行依据）

- `POST /api/humanthink/sessions/:id/plan/validate` body=PlanPayload → `{issues: PlanIssue[]}`（PlanIssue=`{taskId?: string, field: string, message: string}`）
- `POST /api/humanthink/sessions/:id/plan/confirm` body=PlanPayload → 成功 `{story: {id: number}, tasks: [{localId: string, id: number}]}`；校验失败 422 `{error:{code:'VALIDATION', details: issues}}` 且零建单
- PlanPayload（两端共用一字面）：
  `{story: {title: string, description: string}, tasks: [{id: string, title: string, spec: string, repoRef?: string, workerId: string, dependsOn?: string[], plannedFiles?: string[]}]}`

## 技术决策

- D1 计划块解析在 web 渲染层（服务端不存草稿——spec 规则「草稿活在会话文本」）；识别失败降级文本
- D2 校验单源 server plan.ts（validate/confirm 共用；web 只展示服务端返回）
- D3 confirm 事务边界=建单+依赖+冻结；放行触发在事务后（失败面=排队非错误，不破坏原子性语义）
- D4 system 提示模板入 config-gen 纯函数（启动期快照注入 repos/workers；与 serve 生命周期一致）
- D5 局部 id 协议：计划内短 id（t1/t2），依赖引用仅限本计划；服务端映射为真实单号
- D6 放行入口收敛：提取既有下游放行核心，两入口（onTicketSettled/planConfirmed）共用，行为面单一

## 依赖

- 块 2 依赖契约冻结节；块 1 依赖 S2b1/S3 交付面（全部在基线）

## 风险

| 风险 | 缓解 |
|---|---|
| 助手产出格式遵循度 | 产出合同模板含格式范例+字段约束；web 解析降级不崩；真机验收按产出→渲染→确认→建单全链（自验证阶段把关） |
| 放行核心提取的回归面 | 提取为纯方法+既有 onTicketSettled 行为不变断言（dispatcher 既有用例回归） |
| 计划卡编辑复杂度 | 增删任务/调依赖最小集；字段级标红（validate 返回定位） |
| 大计划事务时长 | 单用户本地 SQLite 事务毫秒级，不设上限（spec 规则 9） |
| system 提示与未来 config 演进冲突 | 模板快照单测锁定；升级窗口重验 |
