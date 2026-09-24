import { useCallback, useEffect, useMemo, useState } from 'react';
import { Form, Input, Modal, Select, Typography } from 'antd';
import { createTicket, getWorkers, listTickets, listWorkspaces } from '../api/tickets';
import type { Ticket, TicketListItem, WorkerInfo, Workspace } from '../api/types';
import { useWorkspace } from '../context/WorkspaceContext';
import { typeLabel } from './StatusTag';

type CreateFormValues = {
  type: 'STORY' | 'TASK';
  workspaceId: string;
  /** 目标仓 id（仅 TASK 有效；缺省=所选 workspace 主仓） */
  repoRef?: string;
  title: string;
  description?: string;
  parentId?: number;
  workerId?: string;
};

/**
 * 建单弹窗（工作台/列表页共用）：
 * - workspace 选择：缺省=顶栏切换器所选，「全部」视图缺省 atd（与 API 缺省一致，弹窗内可显式覆写）
 * - parentId 仅 STORY 候选（server 契约：父单必须为 STORY，且仅 TASK 可有父）；
 *   候选随所选 workspace 过滤（同 workspace 才可挂父子，跨值会被 server 422 拒绝）
 * - type=TASK 时可选目标仓（所选 workspace 的 repos，主仓标「主」并缺省）与预绑定 worker
 *   （编排链拆单场景：依赖满足后自动放行的前提；不绑则放行时必须人工选 worker）
 * - 创建成功后回调 onCreated（调用方决定跳转或刷新）
 */
export default function CreateTicketModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ticket: Ticket) => void;
}) {
  const [form] = Form.useForm<CreateFormValues>();
  const [creating, setCreating] = useState(false);
  const [parentOptions, setParentOptions] = useState<TicketListItem[]>([]);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  // workspace 列表为独立请求（不走模块缓存：弹窗打开时取最新，几十条量级直查即可）
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  const { workspaceId: ctxWorkspaceId } = useWorkspace();
  const ticketType = Form.useWatch('type', form);
  const formWorkspaceId = Form.useWatch('workspaceId', form);

  const loadCandidates = useCallback(async () => {
    // workspace 列表与 worker 注册表快照，打开时刷新
    try {
      setWorkspaces(await listWorkspaces());
    } catch {
      setWorkspaces([]);
    }
    setWorkersLoading(true);
    try {
      setWorkers(await getWorkers());
    } catch {
      setWorkers([]);
    } finally {
      setWorkersLoading(false);
    }
  }, []);

  // 父单候选（仅 STORY）随表单所选 workspace 过滤；表单未初始化前不拉
  useEffect(() => {
    if (formWorkspaceId == null) return;
    let alive = true;
    listTickets({ type: 'STORY', workspaceId: formWorkspaceId })
      .then((res) => {
        if (alive) setParentOptions(res.items);
      })
      .catch(() => {
        if (alive) setParentOptions([]);
      });
    return () => {
      alive = false;
    };
  }, [formWorkspaceId]);

  useEffect(() => {
    if (open) {
      form.resetFields();
      void loadCandidates();
    }
  }, [open, form, loadCandidates]);

  // workspace 列表就绪且表单未选时初始化缺省：Context 所选 → atd（全部视图/API 缺省）→ 列表第一个
  useEffect(() => {
    if (!open || workspaces.length === 0) return;
    if (form.getFieldValue('workspaceId') != null) return;
    const preferred = ctxWorkspaceId ?? 'atd';
    const initial = workspaces.some((w) => w.id === preferred) ? preferred : workspaces[0].id;
    const ws = workspaces.find((w) => w.id === initial);
    if (ws != null) {
      form.setFieldsValue({ workspaceId: ws.id, repoRef: ws.primary });
    }
  }, [open, workspaces, ctxWorkspaceId, form]);

  /** 切换 workspace：目标仓重置为新主仓、父单清空（候选随新 workspace 重拉，旧选择必然失效） */
  function handleWorkspaceChange(wsId: string) {
    const ws = workspaces.find((w) => w.id === wsId);
    form.resetFields(['parentId']);
    form.setFieldsValue({ repoRef: ws?.primary });
  }

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === formWorkspaceId),
    [workspaces, formWorkspaceId],
  );

  async function handleOk() {
    const values = await form.validateFields();
    setCreating(true);
    try {
      const ticket = await createTicket({
        type: values.type,
        workspaceId: values.workspaceId,
        title: values.title,
        description: values.description?.trim() === '' ? undefined : values.description,
        parentId: values.parentId,
        // 仅 TASK 携带 workerId/repoRef（server 对 STORY 带这两项不落库，前端收敛不传）
        workerId: values.type === 'TASK' ? values.workerId : undefined,
        repoRef: values.type === 'TASK' ? values.repoRef : undefined,
      });
      onClose();
      onCreated(ticket);
    } catch {
      // 错误已由 api 层统一 toast（如 parentId 非 STORY → DAG_INVALID / repoRef 失效 → REPO_REF_INVALID）
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      title="新建工单"
      open={open}
      confirmLoading={creating}
      okText="创建"
      cancelText="取消"
      onOk={handleOk}
      onCancel={onClose}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ type: 'STORY' }}>
        <Form.Item name="type" label="类型" rules={[{ required: true }]} tooltip="仅支持 STORY / TASK；STORY 可挂子单">
          <Select
            options={[
              { value: 'STORY', label: typeLabel('STORY') },
              { value: 'TASK', label: typeLabel('TASK') },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="workspaceId"
          label="工作空间"
          rules={[{ required: true, message: '请选择工作空间' }]}
          tooltip="工单所属的项目群；带父单时强制继承父单所属 workspace"
        >
          <Select
            loading={workspaces.length === 0}
            placeholder="选择工作空间"
            options={workspaces.map((w) => ({ value: w.id, label: `${w.name} · ${w.primary}` }))}
            onChange={handleWorkspaceChange}
          />
        </Form.Item>
        <Form.Item name="title" label="标题" rules={[{ required: true, message: '标题不能为空' }]}>
          <Input placeholder="一句话说明这个工单" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="背景与验收要点（可选）" />
        </Form.Item>
        {ticketType === 'TASK' && (
          <Form.Item
            name="repoRef"
            label="目标仓"
            tooltip="TASK 的执行目标仓（worktree 建于该仓，建单后不可变）；缺省主仓。STORY 为纯编排单无仓语义"
          >
            <Select
              placeholder="主仓（缺省）"
              options={(selectedWorkspace?.repos ?? []).map((r) => ({
                value: r.id,
                label: r.id === selectedWorkspace?.primary ? `${r.id}（主）` : r.id,
              }))}
            />
          </Form.Item>
        )}
        {ticketType === 'TASK' && (
          <Form.Item
            name="parentId"
            label="父单"
            tooltip="仅同 workspace 的 STORY 可为父；同 STORY 下的子单可建依赖链（依赖满足后自动放行需预绑定 worker）"
          >
            <Select
              allowClear
              placeholder="无（顶层工单）"
              options={parentOptions.map((p) => ({ value: p.id, label: `#${p.id} ${p.title}` }))}
            />
          </Form.Item>
        )}
        {ticketType === 'TASK' && (
          <Form.Item
            name="workerId"
            label="预绑定 worker"
            tooltip="可选：编排链场景建单即定执行者；依赖满足后系统自动放行。不绑则需人工放行时选择"
          >
            <Select
              allowClear
              loading={workersLoading}
              placeholder="不预绑定（放行时选择）"
              options={workers.map((w) => ({
                value: w.id,
                label: `${w.name}（${w.protocol} · ${w.capabilities.join(' / ')}）`,
              }))}
            />
          </Form.Item>
        )}
      </Form>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        建单初始为草稿态；提交 spec 冻结快照后进入规格就绪，方可放行派发。
      </Typography.Text>
    </Modal>
  );
}
