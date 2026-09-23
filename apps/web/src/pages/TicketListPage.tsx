import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Select, Space, Table, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { listTickets } from '../api/tickets';
import type { TicketListItem, TicketStatus, TicketType } from '../api/types';
import StatusTag, { TypeTag, statusLabel, typeLabel } from '../components/StatusTag';
import CreateTicketModal from '../components/CreateTicketModal';
import { formatTime } from '../utils/format';

/** 状态筛选项（S2a 八态全量） */
const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = (
  ['DRAFT', 'SPEC_READY', 'DISPATCHED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED', 'FAILED'] as TicketStatus[]
).map((s) => ({ value: s, label: statusLabel(s) }));

/** 类型筛选项：建单全集 + BLOCKER（卡点队列入口，spec §5） */
const TYPE_OPTIONS: { value: TicketType; label: string }[] = (
  ['STORY', 'TASK', 'BLOCKER'] as TicketType[]
).map((t) => ({ value: t, label: typeLabel(t) }));

/** 全量列表页（兜底视图）：日常入口在工作台/仪表盘，本页保留完整表格与筛选 */
export default function TicketListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | undefined>();
  const [typeFilter, setTypeFilter] = useState<TicketType | undefined>();
  const [createOpen, setCreateOpen] = useState(false);

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

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="工单列表"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              刷新
            </Button>
            <Button type="primary" onClick={() => setCreateOpen(true)}>
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

      {/* 建单弹窗与工作台共用（TASK 支持预绑定 worker） */}
      <CreateTicketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(ticket) => navigate(`/tickets/${ticket.id}`)}
      />
    </div>
  );
}
