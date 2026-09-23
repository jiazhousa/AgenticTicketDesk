import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, List, Space, Spin, Tag, Typography } from 'antd';
import { FileSearchOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getTicket, getWorkers, listTickets } from '../api/tickets';
import type { TicketDetail, TicketListItem, WorkerInfo } from '../api/types';
import StatusLight from '../components/StatusLight';
import StatusTag, { TypeTag, statusLabel } from '../components/StatusTag';
import RepoRefTag from '../components/RepoRefTag';
import { formatDuration } from '../utils/format';
import { useInterval, useNow } from '../utils/hooks';
import { useWorkspace } from '../context/WorkspaceContext';
import { useWorkspaceMap } from '../utils/workspace';

/** 仪表盘轮询间隔 */
const POLL_MS = 5000;

/** 单行执行视图：呼吸灯 + 标题 + worker + 轮次 + 时长 + 日志入口 */
type RunningRow = {
  item: TicketListItem;
  detail: TicketDetail | null;
};

/**
 * 仪表盘 = 全局运行视图，两区（同数据两视角）：
 * ① 进行中单：DISPATCHED / IN_PROGRESS 工单行（呼吸灯 + worker + 轮次 + 实时时长）
 * ② 执行中 worker 卡片流：按 worker 分组，组内单点开直达日志页（类 CI job 入口）
 */
export default function DashboardPage() {
  // 顶栏切换器所选 workspace（null=全部）；切换即触发下方 load 重建重拉
  const { workspaceId } = useWorkspace();
  const workspaceMap = useWorkspaceMap();
  const [rows, setRows] = useState<RunningRow[] | null>(null);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);

  const load = useCallback(async () => {
    // workspaceId 不传=全量（「全部」视图）；两视角同过滤口径
    const [dispatched, inProgress, workerList] = await Promise.all([
      listTickets({ status: 'DISPATCHED', workspaceId: workspaceId ?? undefined }).catch(() => ({ items: [] as TicketListItem[] })),
      listTickets({ status: 'IN_PROGRESS', workspaceId: workspaceId ?? undefined }).catch(() => ({ items: [] as TicketListItem[] })),
      getWorkers().catch(() => [] as WorkerInfo[]),
    ]);
    setWorkers(workerList);
    // 详情补齐 execution.startedAt / workerName（时长与展示名数据源；失败降级列表行）
    const items = [...inProgress.items, ...dispatched.items];
    const details = await Promise.all(items.map((t) => getTicket(t.id).catch(() => null)));
    setRows(items.map((item, i) => ({ item, detail: details[i] })));
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useInterval(() => void load(), POLL_MS);

  // 有执行中单时每秒跳动刷新耗时
  const now = useNow(rows != null && rows.length > 0);

  const workerNameById = useMemo(() => new Map(workers.map((w) => [w.id, w.name])), [workers]);

  // 视角二：按 worker 分组（未绑定的归「未绑定」组，含人工推进的 STORY）
  const groups = useMemo(() => {
    if (rows == null) return [];
    const map = new Map<string, RunningRow[]>();
    for (const row of rows) {
      const key = row.item.workerId ?? '(未绑定)';
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([workerId, list]) => ({
        workerId,
        list: list.sort((a, b) => (a.detail?.execution?.startedAt ?? a.item.updatedAt) - (b.detail?.execution?.startedAt ?? b.item.updatedAt)),
      }))
      .sort((a, b) => a.workerId.localeCompare(b.workerId));
  }, [rows]);

  if (rows == null) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="加载中…" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1080, margin: '0 auto' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            仪表盘
            <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400, marginLeft: 12 }}>
              全局运行视图：进行中的单与执行中的 worker
            </Typography.Text>
          </Typography.Title>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </div>

        {/* 区1：进行中单 */}
        <Card title={`进行中单（${rows.length}）`}>
          {rows.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有进行中的工单" />
          ) : (
            <List
              size="small"
              dataSource={rows}
              rowKey={(r) => r.item.id}
              renderItem={({ item, detail }) => (
                <List.Item
                  style={{ padding: '10px 0' }}
                  actions={[
                    item.round < 1 ? (
                      <Button key="logs" size="small" icon={<FileSearchOutlined />} disabled>
                        日志
                      </Button>
                    ) : (
                      <Link key="logs" to={`/tickets/${item.id}/logs`}>
                        <Button size="small" icon={<FileSearchOutlined />}>
                          日志
                        </Button>
                      </Link>
                    ),
                    <Link key="detail" to={`/tickets/${item.id}`}>
                      <Button size="small" type="text">
                        详情
                      </Button>
                    </Link>,
                  ]}
                >
                  <Space wrap>
                    <StatusLight status={item.status} />
                    <StatusTag status={item.status} />
                    <TypeTag type={item.type} />
                    <Link to={`/tickets/${item.id}`}>
                      <Typography.Text strong>
                        #{item.id} {item.title}
                      </Typography.Text>
                    </Link>
                    <Tag style={{ marginInlineEnd: 0 }}>
                      {detail?.workerName ?? item.workerId ?? '未绑定 worker'}
                    </Tag>
                    <RepoRefTag ticket={item} workspaceMap={workspaceMap} />
                    <Typography.Text type="secondary">第 {item.round} 轮</Typography.Text>
                    <Typography.Text type={item.status === 'IN_PROGRESS' ? 'warning' : 'secondary'}>
                      {detail?.execution ? formatDuration(now - detail.execution.startedAt) : item.status === 'DISPATCHED' ? '派发中…' : '—'}
                    </Typography.Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>

        {/* 区2：执行中 worker 卡片流（同数据另一视角：按 worker 分组） */}
        <Card title={`执行中 worker（${groups.length}）`}>
          {groups.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有执行中的 worker" />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {groups.map(({ workerId, list }) => (
                <Card
                  key={workerId}
                  size="small"
                  title={
                    <Space>
                      <StatusLight status={list[0].item.status} size={8} />
                      <span>{workerNameById.get(workerId) ?? (workerId === '(未绑定)' ? '未绑定 worker' : workerId)}</span>
                      <Tag style={{ marginInlineEnd: 0 }}>{list.length} 单</Tag>
                    </Space>
                  }
                >
                  <Space direction="vertical" style={{ width: '100%' }} size={4}>
                    {list.map(({ item, detail }) => (
                      <Link key={item.id} to={`/tickets/${item.id}/logs`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <StatusLight status={item.status} size={8} />
                        <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis={{ tooltip: `#${item.id} ${item.title}` }}>
                          #{item.id} {item.title}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12, flex: 'none' }}>
                          r{item.round}
                          {detail?.execution ? ` · ${formatDuration(now - detail.execution.startedAt)}` : ''}
                        </Typography.Text>
                      </Link>
                    ))}
                  </Space>
                </Card>
              ))}
            </div>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            点击卡片内单据进入日志页（{statusLabel('IN_PROGRESS')}橙呼吸 / {statusLabel('DISPATCHED')}青呼吸=即将执行）。
          </Typography.Text>
        </Card>
      </Space>
    </div>
  );
}
