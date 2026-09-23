import { useCallback, useEffect, useState } from 'react';
import { Form, Input, Modal, Select, Typography } from 'antd';
import { createTicket, getWorkers, listTickets } from '../api/tickets';
import type { Ticket, TicketListItem, WorkerInfo } from '../api/types';
import { typeLabel } from './StatusTag';

type CreateFormValues = {
  type: 'STORY' | 'TASK';
  title: string;
  description?: string;
  parentId?: number;
  workerId?: string;
};

/**
 * 建单弹窗（工作台/列表页共用）：
 * - parentId 仅 STORY 候选（server 契约：父单必须为 STORY，且仅 TASK 可有父）
 * - type=TASK 时可选预绑定 worker（编排链拆单场景：依赖满足后自动放行的前提；
 *   不绑则放行时必须人工选 worker）
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

  const loadCandidates = useCallback(async () => {
    // 父单候选（仅 STORY）与 worker 注册表快照，打开时刷新
    try {
      const res = await listTickets({ type: 'STORY' });
      setParentOptions(res.items);
    } catch {
      setParentOptions([]);
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

  useEffect(() => {
    if (open) {
      form.resetFields();
      void loadCandidates();
    }
  }, [open, form, loadCandidates]);

  const ticketType = Form.useWatch('type', form);

  async function handleOk() {
    const values = await form.validateFields();
    setCreating(true);
    try {
      const ticket = await createTicket({
        type: values.type,
        title: values.title,
        description: values.description?.trim() === '' ? undefined : values.description,
        parentId: values.parentId,
        // 仅 TASK 携带 workerId（server 对 STORY 带 workerId 不报错但不落库语义，前端收敛）
        workerId: values.type === 'TASK' ? values.workerId : undefined,
      });
      onClose();
      onCreated(ticket);
    } catch {
      // 错误已由 api 层统一 toast（如 parentId 非 STORY → DAG_INVALID）
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
        <Form.Item name="title" label="标题" rules={[{ required: true, message: '标题不能为空' }]}>
          <Input placeholder="一句话说明这个工单" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="背景与验收要点（可选）" />
        </Form.Item>
        {ticketType === 'TASK' && (
          <Form.Item
            name="parentId"
            label="父单"
            tooltip="仅 STORY 可为父；同 STORY 下的子单可建依赖链（依赖满足后自动放行需预绑定 worker）"
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
