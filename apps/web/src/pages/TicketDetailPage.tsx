import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Spin, Typography } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getTicket } from '../api/tickets';
import type { TicketDetail } from '../api/types';
import StatusTag, { TypeTag } from '../components/StatusTag';
import TransitionActions from '../components/TransitionActions';
import SpecCard from '../components/SpecCard';
import DependencyPanel from '../components/DependencyPanel';
import CommentStream from '../components/CommentStream';
import Timeline from '../components/Timeline';
import { formatTime } from '../utils/format';

/**
 * 工单详情页：四卡布局——①基本信息+状态操作 ②spec 快照 ③依赖与父子 ④留言+时间线。
 * hasCancelledChildren=true 时顶部 Alert 提示（A7 锚点：CANCELLED 子单不阻塞父单关单，需人工裁决）。
 */
export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ticketId = Number(params.id);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  // 加载失败且无缓存数据时显示空态（有缓存时保留旧数据，错误已 toast）
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (id: number, hasCache: boolean) => {
    setLoading(true);
    setFailed(false);
    try {
      setDetail(await getTicket(id));
    } catch {
      setFailed(!hasCache);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 切换单号时清空旧数据再加载（无缓存，失败显示空态）
    setDetail(null);
    void load(ticketId, false);
  }, [ticketId, load]);

  /** 页面动作后的重载：有缓存时失败保留旧数据（错误已 toast） */
  const reload = useCallback(() => {
    void load(ticketId, detail != null);
  }, [ticketId, detail, load]);

  const invalidId = !Number.isInteger(ticketId) || ticketId <= 0;
  if (invalidId || (failed && detail == null)) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="warning"
          message="工单不存在或已加载失败"
          description={<Link to="/tickets">返回列表</Link>}
          showIcon
        />
      </div>
    );
  }

  if (detail == null) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="加载中…" />
      </div>
    );
  }

  const { ticket } = detail;

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 页头 */}
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tickets')}>
            返回
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            #{ticket.id} {ticket.title}
          </Typography.Title>
          <TypeTag type={ticket.type} />
          <StatusTag status={ticket.status} />
          <Button icon={<ReloadOutlined />} onClick={() => reload()} loading={loading} />
        </Space>

        {/* A7 锚点：CANCELLED 子单提示（不阻塞关单，人工裁决） */}
        {detail.hasCancelledChildren && (
          <Alert
            type="warning"
            showIcon
            message="存在已取消子单，请裁决"
            description="该 STORY 下有子单被取消。已取消子单不会阻塞父单关单；请确认是继续推进（其余子单完成后关单）还是取消整个父单。"
          />
        )}

        {/* 卡1：基本信息 + 状态操作 */}
        <Card title="基本信息">
          <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
            <Descriptions.Item label="单号">#{ticket.id}</Descriptions.Item>
            <Descriptions.Item label="类型"><TypeTag type={ticket.type} /></Descriptions.Item>
            <Descriptions.Item label="状态"><StatusTag status={ticket.status} /></Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatTime(ticket.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{formatTime(ticket.updatedAt)}</Descriptions.Item>
            <Descriptions.Item label="worker">{ticket.workerId ?? '（未绑定，S2a 消费）'}</Descriptions.Item>
            <Descriptions.Item label="描述" span={3}>
              {ticket.description ?? '（无描述）'}
            </Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 16 }}>
            <TransitionActions ticket={ticket} onChanged={() => reload()} />
          </div>
        </Card>

        {/* 卡2：spec 快照 */}
        <SpecCard ticket={ticket} onChanged={() => reload()} />

        {/* 卡3：依赖与父子 */}
        <DependencyPanel
          ticket={ticket}
          children={detail.children}
          dependencies={detail.dependencies}
          onChanged={() => reload()}
        />

        {/* 卡4：留言 + 转移历史 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
          <CommentStream ticketId={ticket.id} comments={detail.comments} onSent={() => reload()} />
          <Timeline transitions={detail.transitions} />
        </div>
      </Space>
    </div>
  );
}
