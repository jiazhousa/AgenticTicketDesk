import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { createTicket, listTickets } from '../api/tickets';
import type { TicketListItem, TicketStatus, TicketType } from '../api/types';
import StatusTag, { TypeTag, statusLabel, typeLabel } from '../components/StatusTag';
import { formatTime } from '../utils/format';

/** 状态筛选项（六态全量） */
const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = (
  ['DRAFT', 'SPEC_READY', 'DISPATCHED', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as TicketStatus[]
).map((s) => ({ value: s, label: statusLabel(s) }));

/** 类型筛选项（S1 建单仅支持 STORY/TASK） */
const TYPE_OPTIONS: { value: TicketType; label: string }[] = (['STORY', 'TASK'] as TicketType[]).map((t) => ({
  value: t,
  label: typeLabel(t),
}));

type CreateFormValues = {
  type: 'STORY' | 'TASK';
  title: string;
  description?: string;
  parentId?: number;
};

export default function TicketListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | undefined>();
  const [typeFilter, setTypeFilter] = useState<TicketType | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // 父单候选（仅 STORY 可为父）
  const [parentOptions, setParentOptions] = useState<TicketListItem[]>([]);
  const [form] = Form.useForm<CreateFormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTickets({ status: statusFilter, type: typeFilter });
      setItems(res.items);
    } catch {
      // 错误已由 api 层统一 toast
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openCreate() {
    // 加载 STORY 候选作父单选项（契约：parentId 指向的单必须为 STORY）
    try {
      const res = await listTickets({ type: 'STORY' });
      setParentOptions(res.items);
    } catch {
      setParentOptions([]);
    }
    form.resetFields();
    setCreateOpen(true);
  }

  async function handleCreate() {
    const values = await form.validateFields();
    setCreating(true);
    try {
      const ticket = await createTicket({
        type: values.type,
        title: values.title,
        description: values.description?.trim() === '' ? undefined : values.description,
        parentId: values.parentId,
      });
      setCreateOpen(false);
      navigate(`/tickets/${ticket.id}`);
    } catch {
      // 错误已由 api 层统一 toast（如 parentId 非 STORY → DAG_INVALID）
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="工单列表"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => void openCreate()}>
              新建工单
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 160 }}
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
          />
          <Select
            allowClear
            placeholder="全部类型"
            style={{ width: 140 }}
            options={TYPE_OPTIONS}
            value={typeFilter}
            onChange={(v) => setTypeFilter(v)}
          />
        </Space>

        <Table<TicketListItem>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
          columns={[
            {
              title: '单号',
              dataIndex: 'id',
              width: 90,
              render: (id: number) => (
                <Link to={`/tickets/${id}`}>
                  <Typography.Text copyable={{ text: String(id) }}>#{id}</Typography.Text>
                </Link>
              ),
            },
            {
              title: '标题',
              dataIndex: 'title',
              ellipsis: true,
              render: (_, record) => <Link to={`/tickets/${record.id}`}>{record.title}</Link>,
            },
            { title: '类型', dataIndex: 'type', width: 90, render: (type: TicketType) => <TypeTag type={type} /> },
            { title: '状态', dataIndex: 'status', width: 110, render: (status: TicketStatus) => <StatusTag status={status} /> },
            {
              title: '父单',
              width: 200,
              ellipsis: true,
              render: (_, record) =>
                record.parentId != null ? (
                  <Link to={`/tickets/${record.parentId}`}>#{record.parentId} {record.parentTitle ?? ''}</Link>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                ),
            },
            {
              title: '子单数',
              dataIndex: 'childrenCount',
              width: 90,
              render: (n: number) => (n > 0 ? n : <Typography.Text type="secondary">0</Typography.Text>),
            },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              width: 150,
              render: (ms: number) => <Typography.Text type="secondary">{formatTime(ms)}</Typography.Text>,
            },
          ]}
        />
      </Card>

      <Modal
        title="新建工单"
        open={createOpen}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
        onOk={() => void handleCreate()}
        onCancel={() => setCreateOpen(false)}
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'STORY' }}>
          <Form.Item name="type" label="类型" rules={[{ required: true }]} tooltip="S1 仅支持 STORY / TASK；STORY 可挂子单">
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '标题不能为空' }]}>
            <Input placeholder="一句话说明这个工单" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="背景与验收要点（可选）" />
          </Form.Item>
          <Form.Item name="parentId" label="父单" tooltip="仅 STORY 可为父；父单将聚合子单状态（子单全 DONE/CANCELLED 才能关单）">
            <Select
              allowClear
              placeholder="无（顶层工单）"
              options={parentOptions.map((p) => ({ value: p.id, label: `#${p.id} ${p.title}` }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
