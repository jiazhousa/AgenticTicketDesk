import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Select, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, ProfileOutlined } from '@ant-design/icons';
import { confirmHtPlan, validateHtPlan } from '../../api/humanthink';
import { getWorkers } from '../../api/tickets';
import type { PlanIssue, PlanPayload, WorkerInfo } from '../../api/types';
import { useWorkspaceMap } from '../../utils/workspace';

/** 任务编辑态（plannedFiles 以文本域形态持有——每行一路径，提交时拆行） */
type EditableTask = {
  id: string;
  title: string;
  spec: string;
  repoRef?: string;
  workerId: string;
  dependsOn: string[];
  plannedFilesText: string;
};

/** 计划编辑态（story + tasks 摊平） */
type EditablePlan = { title: string; description: string; tasks: EditableTask[] };

/** worker 注册表模块级缓存：Registry 运行期不变，多张计划卡共享一次请求（失败不缓存，下次挂载重试） */
let workersPromise: Promise<WorkerInfo[]> | null = null;

function fetchWorkers(): Promise<WorkerInfo[]> {
  if (workersPromise == null) {
    workersPromise = getWorkers().catch((err) => {
      workersPromise = null;
      throw err;
    });
  }
  return workersPromise;
}

/** worker 清单 hook（null=加载中/失败——Select 降级为空列表，服务端预检兜底标红） */
function useWorkers(): WorkerInfo[] | null {
  const [workers, setWorkers] = useState<WorkerInfo[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchWorkers()
      .then((list) => {
        if (alive) setWorkers(list);
      })
      .catch(() => {
        // 保持 null：下拉空展示，字段值仍可见（toast 已由 api 层弹出）
      });
    return () => {
      alive = false;
    };
  }, []);
  return workers;
}

/** 从既有局部 id 集合生成下一个（t{n} 后缀最大值 +1；非 t 数字形态不参与推号，冲突时递增兜底） */
function nextLocalId(tasks: EditableTask[]): string {
  let max = 0;
  for (const t of tasks) {
    const m = /^t(\d+)$/.exec(t.id);
    if (m != null) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  const ids = new Set(tasks.map((t) => t.id));
  while (ids.has(`t${n}`)) n++;
  return `t${n}`;
}

/** PlanPayload → 编辑态（plannedFiles 数组 join 回文本域形态） */
function toEditable(plan: PlanPayload): EditablePlan {
  return {
    title: plan.story.title,
    description: plan.story.description,
    tasks: plan.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      spec: t.spec,
      repoRef: t.repoRef,
      workerId: t.workerId,
      dependsOn: [...(t.dependsOn ?? [])],
      plannedFilesText: (t.plannedFiles ?? []).join('\n'),
    })),
  };
}

/** 编辑态 → PlanPayload（空集字段省略：repoRef 缺省主仓 / dependsOn·plannedFiles 空视同未声明） */
function toPayload(edit: EditablePlan): PlanPayload {
  return {
    story: { title: edit.title, description: edit.description },
    tasks: edit.tasks.map((t) => {
      const repoRef = t.repoRef?.trim();
      const plannedFiles = t.plannedFilesText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      return {
        id: t.id,
        title: t.title,
        spec: t.spec,
        repoRef: repoRef !== '' && repoRef != null ? repoRef : undefined,
        workerId: t.workerId,
        dependsOn: t.dependsOn.length > 0 ? t.dependsOn : undefined,
        plannedFiles: plannedFiles.length > 0 ? plannedFiles : undefined,
      };
    }),
  };
}

/** 字段级错误文案（taskId=null 匹配 story 级；多条拼接） */
function issueText(issues: PlanIssue[] | null, taskId: string | null, field: PlanIssue['field']): string {
  return (issues ?? [])
    .filter((i) => (i.taskId ?? null) === taskId && i.field === field)
    .map((i) => i.message)
    .join('；');
}

/** 字段下方红字（空文案不渲染） */
function FieldError({ text }: { text: string }) {
  if (text === '') return null;
  return (
    <Typography.Text type="danger" style={{ fontSize: 12 }}>
      {text}
    </Typography.Text>
  );
}

/**
 * 拆单计划卡（assistant 消息内 ```atd-plan 块解析成功后渲染）：
 * - 编辑态本地（刷新回原稿——草稿活在会话文本，服务端不存草稿）；任何编辑清空上次校验标红
 * - 预检=validate 返回 issues 按 taskId/field 定位标红；确认=confirm 双态（ok:false 同样标红不跳转）
 * - repoRef 取值域=会话所属 workspace 的 repos（缺省主仓）；workerId=Registry 可用 worker
 * - dependsOn 多选=计划内局部 id（排除自身）；plannedFiles 文本域每行一路径
 * - readOnly（已删会话）：plan 端点 422，禁用全部操作
 */
export default function PlanCard({
  plan,
  sessionId,
  workspaceId,
  readOnly = false,
  onConfirmed,
}: {
  plan: PlanPayload;
  sessionId: string;
  workspaceId: string;
  readOnly?: boolean;
  onConfirmed?: (storyId: number) => void;
}) {
  const [edit, setEdit] = useState<EditablePlan>(() => toEditable(plan));
  /** 最近一次服务端校验结果（null=未校验；[] = 通过）；编辑即清空（标红只反映已提交的载荷） */
  const [issues, setIssues] = useState<PlanIssue[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** 确认成功态（防重复建单；携带 STORY 单号供跳转/展示） */
  const [confirmed, setConfirmed] = useState<number | null>(null);

  const workspaceMap = useWorkspaceMap();
  const workers = useWorkers();
  const workspace = workspaceMap?.get(workspaceId);
  const repoOptions = (workspace?.repos ?? []).map((r) => ({
    value: r.id,
    label: r.id === workspace?.primary ? `${r.id}（主）` : r.id,
  }));
  // 全量注册表（不过滤 available）——任务执行走 task 模式：与 server 校验取值域（∈Registry）和系统提示 workers 段严格一致（块间对账裁决：available 仅对聊天会话下拉有意义）
  const workerOptions = (workers ?? []).map((w) => ({
    value: w.id,
    label: `${w.name}（${w.id}）`,
  }));

  const disabled = readOnly || confirmed != null;

  /** 通用编辑入口：套用变更并清空校验标红（编辑后旧结论失效） */
  function mutate(fn: (draft: EditablePlan) => void) {
    setEdit((prev) => {
      const draft: EditablePlan = {
        title: prev.title,
        description: prev.description,
        tasks: prev.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })),
      };
      fn(draft);
      return draft;
    });
    setIssues(null);
  }

  function updateTask(index: number, patch: Partial<EditableTask>) {
    mutate((draft) => {
      draft.tasks[index] = { ...draft.tasks[index], ...patch };
    });
  }

  /** 删除任务：同步清除其余任务 dependsOn 对其的引用（防悬挂局部 id） */
  function removeTask(index: number) {
    mutate((draft) => {
      const removed = draft.tasks[index].id;
      draft.tasks.splice(index, 1);
      for (const t of draft.tasks) t.dependsOn = t.dependsOn.filter((d) => d !== removed);
    });
  }

  function addTask() {
    mutate((draft) => {
      draft.tasks.push({
        id: nextLocalId(draft.tasks),
        title: '',
        spec: '',
        workerId: '',
        dependsOn: [],
        plannedFilesText: '',
      });
    });
  }

  async function handleValidate() {
    setValidating(true);
    try {
      const res = await validateHtPlan(sessionId, toPayload(edit));
      setIssues(res.issues);
    } catch {
      // 网络层失败 toast 已弹；标红保留待重试
    } finally {
      setValidating(false);
    }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      const res = await confirmHtPlan(sessionId, toPayload(edit));
      if (res.ok) {
        setConfirmed(res.story.id);
        onConfirmed?.(res.story.id);
      } else {
        // 校验失败（200 双态）：零建单，issues 同预检定位标红，不跳转
        setIssues(res.issues);
      }
    } catch {
      // 网络层失败 toast 已弹，可重试
    } finally {
      setConfirming(false);
    }
  }

  const issuesSummary = useMemo(() => {
    if (issues == null || issues.length === 0) return null;
    return issues.map((i, idx) => (
      <li key={idx} style={{ margin: '2px 0' }}>
        {i.taskId != null ? `${i.taskId} · ` : 'story · '}
        {i.field}：{i.message}
      </li>
    ));
  }, [issues]);

  return (
    <div
      style={{
        width: '100%',
        border: '1px solid #dedede',
        borderRadius: 10,
        background: '#fff',
        padding: '10px 14px',
      }}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {/* 卡头 */}
        <Space wrap size={6}>
          <ProfileOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>拆单计划</Typography.Text>
          <Tag>{edit.tasks.length} 个任务</Tag>
          {confirmed != null ? <Tag color="success">已建 STORY #{confirmed}</Tag> : null}
          {readOnly ? <Tag color="red">只读</Tag> : null}
        </Space>

        {/* story 区 */}
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            STORY 标题
          </Typography.Text>
          <Input
            value={edit.title}
            disabled={disabled}
            status={issueText(issues, null, 'title') !== '' ? 'error' : undefined}
            onChange={(e) => {
              const v = e.target.value;
              mutate((d) => {
                d.title = v;
              });
            }}
            placeholder="一句话说明这个需求"
          />
          <FieldError text={issueText(issues, null, 'title')} />
        </div>
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            STORY 描述
          </Typography.Text>
          <Input.TextArea
            value={edit.description}
            disabled={disabled}
            rows={2}
            onChange={(e) => {
              const v = e.target.value;
              mutate((d) => {
                d.description = v;
              });
            }}
            placeholder="背景与验收要点"
          />
        </div>

        {/* 任务卡列表 */}
        {edit.tasks.map((t, i) => {
          const others = edit.tasks.filter((x) => x.id !== t.id);
          return (
            <div
              key={t.id}
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                background: '#fafafa',
                padding: '8px 10px',
              }}
            >
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Space size={6} style={{ width: '100%', display: 'flex' }}>
                  <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                    {t.id}
                  </Tag>
                  <Input
                    value={t.title}
                    disabled={disabled}
                    status={issueText(issues, t.id, 'title') !== '' ? 'error' : undefined}
                    placeholder="任务标题"
                    style={{ flex: 1, minWidth: 0 }}
                    onChange={(e) => updateTask(i, { title: e.target.value })}
                  />
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={disabled}
                    onClick={() => removeTask(i)}
                  />
                </Space>
                <FieldError text={issueText(issues, t.id, 'id')} />
                <FieldError text={issueText(issues, t.id, 'title')} />
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    spec（业务语言）
                  </Typography.Text>
                  <Input.TextArea
                    value={t.spec}
                    disabled={disabled}
                    rows={3}
                    status={issueText(issues, t.id, 'spec') !== '' ? 'error' : undefined}
                    placeholder="任务要做什么、验收标准（不含技术实现细节）"
                    onChange={(e) => updateTask(i, { spec: e.target.value })}
                  />
                  <FieldError text={issueText(issues, t.id, 'spec')} />
                </div>
                <Space wrap size={8} style={{ display: 'flex' }}>
                  <div style={{ minWidth: 200, flex: 1 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      目标仓
                    </Typography.Text>
                    <Select
                      value={t.repoRef}
                      disabled={disabled}
                      allowClear
                      placeholder="主仓（缺省）"
                      style={{ width: '100%' }}
                      loading={workspace == null}
                      options={repoOptions}
                      status={issueText(issues, t.id, 'repoRef') !== '' ? 'error' : undefined}
                      onChange={(v) => updateTask(i, { repoRef: v })}
                    />
                  </div>
                  <div style={{ minWidth: 200, flex: 1 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      worker
                    </Typography.Text>
                    <Select
                      value={t.workerId === '' ? undefined : t.workerId}
                      disabled={disabled}
                      showSearch
                      placeholder="选择执行 worker"
                      style={{ width: '100%' }}
                      loading={workers == null}
                      options={workerOptions}
                      status={issueText(issues, t.id, 'workerId') !== '' ? 'error' : undefined}
                      onChange={(v) => updateTask(i, { workerId: v ?? '' })}
                    />
                  </div>
                </Space>
                <FieldError text={issueText(issues, t.id, 'repoRef')} />
                <FieldError text={issueText(issues, t.id, 'workerId')} />
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    依赖（dependsOn）
                  </Typography.Text>
                  <Select
                    mode="multiple"
                    value={t.dependsOn}
                    disabled={disabled}
                    placeholder="无依赖"
                    style={{ width: '100%' }}
                    options={others.map((x) => ({ value: x.id, label: `${x.id} ${x.title}`.trim() }))}
                    status={issueText(issues, t.id, 'dependsOn') !== '' ? 'error' : undefined}
                    onChange={(v) => updateTask(i, { dependsOn: v })}
                  />
                  <FieldError text={issueText(issues, t.id, 'dependsOn')} />
                </div>
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    计划改动文件（每行一路径，目录以 / 结尾）
                  </Typography.Text>
                  <Input.TextArea
                    value={t.plannedFilesText}
                    disabled={disabled}
                    rows={2}
                    status={issueText(issues, t.id, 'plannedFiles') !== '' ? 'error' : undefined}
                    placeholder={'apps/web/src/xxx.tsx\npackages/core/src/'}
                    style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                    onChange={(e) => updateTask(i, { plannedFilesText: e.target.value })}
                  />
                  <FieldError text={issueText(issues, t.id, 'plannedFiles')} />
                </div>
              </Space>
            </div>
          );
        })}

        {/* 校验结果汇总（预检/确认失败共用） */}
        {issuesSummary != null ? (
          <Alert type="error" showIcon message="校验未通过" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{issuesSummary}</ul>} />
        ) : issues != null && issues.length === 0 ? (
          <Alert type="success" showIcon message="预检通过，可确认建单" />
        ) : null}

        {/* 操作区 */}
        <Space wrap size={8} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button size="small" icon={<PlusOutlined />} disabled={disabled} onClick={addTask}>
            添加任务
          </Button>
          <Space size={8}>
            <Button disabled={disabled} loading={validating} onClick={() => void handleValidate()}>
              预检
            </Button>
            <Button
              type="primary"
              disabled={disabled}
              loading={confirming}
              onClick={() => void handleConfirm()}
            >
              {confirmed != null ? `已建 STORY #${confirmed}` : '确认建单'}
            </Button>
          </Space>
        </Space>
      </Space>
    </div>
  );
}
