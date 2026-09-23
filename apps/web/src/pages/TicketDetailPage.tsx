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
import ExecutionCard from '../components/ExecutionCard';
import StorySwimlane from '../components/StorySwimlane';
import ReportCard from '../components/ReportCard';
import BlockerCard from '../components/BlockerCard';
import { formatTime } from '../utils/format';

/**
 * 工单详情页（验收反馈后瘦身）：执行卡只留 状态/worker/轮次/时长 + 日志入口——
 * worker 原始事件流不在详情页展示（独立日志页）。卡布局：
 * ①基本信息+状态操作 ②执行卡（瘦身后）③完成报告（DONE）④卡点处理（BLOCKED/BLOCKER）
 * ⑤Story 泳道链（STORY 核心区块：子单依赖 DAG）⑥spec 快照 ⑦依赖与父子 ⑧留言+时间线。
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

  const { ticket, blocks } = detail;

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
            <Descriptions.Item label="worker">
              {detail.workerName ?? ticket.workerId ?? '（未绑定）'}
            </Descriptions.Item>
            <Descriptions.Item label="执行轮次">{ticket.round}</Descriptions.Item>
            {ticket.pendingLabel != null && (
              <Descriptions.Item label="卡点层级">
                <Typography.Text type="danger">{ticket.pendingLabel}</Typography.Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="描述" span={3}>
              {ticket.description ?? '（无描述）'}
            </Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 16 }}>
            <TransitionActions ticket={ticket} onChanged={() => reload()} />
          </div>
        </Card>

        {/* 卡2：执行（瘦身后：状态+worker+轮次+时长+日志入口；worker 绑定或执行过的 TASK 展示） */}
        {ticket.type === 'TASK' && (ticket.workerId != null || ticket.round >= 1) && (
          <ExecutionCard
            ticket={ticket}
            workerName={detail.workerName}
            execution={detail.execution}
            transitions={detail.transitions}
            onChanged={() => reload()}
          />
        )}

        {/* 卡3：完成报告（DONE 且有报告；commits 为工单级 git 实测归集） */}
        {ticket.status === 'DONE' && detail.report != null && (
          <ReportCard report={detail.report} commits={detail.commits} />
        )}

        {/* 卡4：卡点处理——父单视角（BLOCKED 态关联未关 BLOCKER） */}
        {ticket.status === 'BLOCKED' &&
          (detail.blocker != null ? (
            <BlockerCard
              blocker={detail.blocker}
              blockReason={detail.report?.blockReason ?? null}
              onChanged={() => reload()}
            />
          ) : (
            // 编排层保证 BLOCKED 存续期间恰好关联一张未关 BLOCKER；缺失属数据异常
            <Alert
              type="error"
              showIcon
              message="数据异常：阻塞态未关联卡点单"
              description="该工单处于阻塞状态但没有对应的未关卡点单，请检查数据一致性。"
            />
          ))}

        {/* 卡4：卡点处理——BLOCKER 单自身视角（resolve 入口；卡点单呈现 BLOCKED(pending:l3)） */}
        {ticket.type === 'BLOCKER' && ticket.status === 'BLOCKED' && (
          <BlockerCard blocker={ticket} parentTicketId={blocks[0]?.id} onChanged={() => reload()} />
        )}

        {/* 卡5：Story 泳道链（STORY 核心区块：子单依赖分层 DAG，并行同列、串行向下） */}
        {ticket.type === 'STORY' && (
          <Card title="编排链泳道">
            <StorySwimlane storyId={ticket.id} />
          </Card>
        )}

        {/* 卡6：spec 快照 */}
        <SpecCard ticket={ticket} onChanged={() => reload()} />

        {/* 卡7：依赖与父子 */}
        <DependencyPanel
          ticket={ticket}
          children={detail.children}
          dependencies={detail.dependencies}
          onChanged={() => reload()}
        />

        {/* 卡8：留言 + 转移历史 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
          <CommentStream ticketId={ticket.id} comments={detail.comments} onSent={() => reload()} />
          <Timeline transitions={detail.transitions} />
        </div>
      </Space>
    </div>
  );
}
