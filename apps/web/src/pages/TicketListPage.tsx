import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Select, Space, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { listTickets } from '../api/tickets';
import type { TicketListItem, TicketStatus, TicketType } from '../api/types';
import StatusTag, { TypeTag, statusLabel, typeLabel } from '../components/StatusTag';
import CreateTicketModal from '../components/CreateTicketModal';
import { resolveRepoRefLabel } from '../components/RepoRefTag';
import { formatTime } from '../utils/format';
import { useWorkspace } from '../context/WorkspaceContext';
import { useWorkspaceMap } from '../utils/workspace';

/** 状态筛选项（S2a 八态全量） */
const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = (
  ['DRAFT', 'SPEC_READY', 'DISPATCHED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED', 'FAILED'] as TicketStatus[]
).map((s) => ({ value: s, label: statusLabel(s) }));

/** 类型筛选项：建单全集（BLOCKER 类型已废除——卡点=原单 BLOCKED 状态，不再是工单类型） */
const TYPE_OPTIONS: { value: TicketType; label: string }[] = (
  ['STORY', 'TASK'] as TicketType[]
).map((t) => ({ value: t, label: typeLabel(t) }));

/** 全量列表页（兜底视图）：日常入口在工作台/仪表盘，本页保留完整表格与筛选；workspace 维度过滤统一收口顶栏切换器 */
export default function TicketListPage() {
  const navigate = useNavigate();
  // 顶栏切换器所选 workspace（null=全部）；切换即触发下方 load 重建重拉
  const { workspaceId } = useWorkspace();
  const workspaceMap = useWorkspaceMap();
  const [items, setItems] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | undefined>();
  const [typeFilter, setTypeFilter] = useState<TicketType | undefined>();
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTickets({ status: statusFilter, type: typeFilter, workspaceId: workspaceId ?? undefined });
      setItems(res.items);
    } catch {
      // 错误已由 api 层统一 toast
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, workspaceId]);

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
            {
              // 目标仓：非主仓 TASK 显示仓名 Tag（主仓省略、非 TASK 无仓语义 → '—'）
              title: '目标仓',
              dataIndex: 'repoRef',
              width: 100,
              render: (_, record) => {
                const label = resolveRepoRefLabel(record, workspaceMap);
                return label != null ? (
                  <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                    {label}
                  </Tag>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                );
              },
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 150,
              render: (_, record) => (
                <Space size={4}>
                  <StatusTag status={record.status} />
                  {/* BLOCKED=卡点内联待裁决，红标提醒（裁决入口在工作台/详情页） */}
                  {record.status === 'BLOCKED' && (
                    <Tag color="red" style={{ marginInlineEnd: 0 }}>
                      待裁决
                    </Tag>
                  )}
                </Space>
              ),
            },
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
