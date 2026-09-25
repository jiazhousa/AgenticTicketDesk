import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Spin, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getTicket } from '../api/tickets';
import type { TicketDetail } from '../api/types';
import StatusTag, { TypeTag } from '../components/StatusTag';
import { resolveRepoRefLabel } from '../components/RepoRefTag';
import QueuedTag from '../components/QueuedTag';
import TransitionActions from '../components/TransitionActions';
import SpecCard from '../components/SpecCard';
import DependencyPanel from '../components/DependencyPanel';
import CommentStream from '../components/CommentStream';
import Timeline from '../components/Timeline';
import ExecutionCard from '../components/ExecutionCard';
import StorySwimlane from '../components/StorySwimlane';
import ReportCard from '../components/ReportCard';
import BlockedResolutionCard from '../components/BlockedResolutionCard';
import { formatDuration, formatTime } from '../utils/format';
import { useNow } from '../utils/hooks';
import { useWorkspaceMap } from '../utils/workspace';

/**
 * 工单详情页（验收反馈后瘦身）：执行卡只留 状态/worker/轮次/时长 + 日志入口——
 * worker 原始事件流不在详情页展示（独立日志页）。卡布局：
 * ①基本信息+状态操作 ②执行卡（瘦身后）③完成报告（DONE）④卡点裁决（BLOCKED——卡点内联于本单状态）
 * ⑤Story 泳道链（STORY 核心区块：子单依赖 DAG）⑥spec 快照 ⑦依赖与父子 ⑧留言+时间线。
 * hasCancelledChildren=true 时顶部 Alert 提示（A7 锚点：CANCELLED 子单不阻塞父单关单，需人工裁决）。
 */
export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ticketId = Number(params.id);
  // workspace 索引（本单所属 workspace 的主仓判定/名称展示；yaml 静态声明，模块级缓存直查）
  const workspaceMap = useWorkspaceMap();
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

  // RETRY_WAIT 倒计时跳动的当前时刻（agent 态阻塞单才启用；须位于早退分支之前保证 hook 顺序稳定）
  const now = useNow(detail != null && detail.ticket.status === 'BLOCKED' && detail.ticket.pendingLabel === 'agent');

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
            <Descriptions.Item label="工作空间">
              {(() => {
                const ws = workspaceMap?.get(ticket.workspaceId);
                return ws != null ? `${ws.name}（${ws.id}）` : ticket.workspaceId;
              })()}
            </Descriptions.Item>
            {ticket.type === 'TASK' && ticket.repoRef != null && (
              // 目标仓：非主仓 geekblue Tag 醒目；主仓普通文本（建单后不可变）
              <Descriptions.Item label="目标仓">
                {resolveRepoRefLabel(ticket, workspaceMap) != null ? (
                  <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>{ticket.repoRef}</Tag>
                ) : (
                  <Typography.Text>{ticket.repoRef}（主仓）</Typography.Text>
                )}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="创建时间">{formatTime(ticket.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{formatTime(ticket.updatedAt)}</Descriptions.Item>
            <Descriptions.Item label="worker">
              {detail.workerName ?? ticket.workerId ?? '（未绑定）'}
            </Descriptions.Item>
            <Descriptions.Item label="执行轮次">{ticket.round}</Descriptions.Item>
            {/* 排队信息（原因+时刻）：SPEC_READY 排队中展示（前序释放后系统自动放行） */}
            {ticket.status === 'SPEC_READY' && ticket.queuedReason != null && (
              <Descriptions.Item label="排队">
                <QueuedTag ticket={ticket} />
              </Descriptions.Item>
            )}
            {ticket.pendingLabel != null && (
              <Descriptions.Item label="卡点层级">
                <Typography.Text type="danger">
                  {ticket.pendingLabel === 'agent' ? 'agent（自动重试中）' : ticket.pendingLabel}
                </Typography.Text>
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

        {/* 卡4：BLOCKED 分流——pending:agent=RETRY_WAIT 自动重试（只读信息，不渲染裁决按钮）；其余（l3）=人工卡点裁决 */}
        {ticket.status === 'BLOCKED' && ticket.pendingLabel === 'agent' && (
          <Card title="自动重试（无需人工处理）">
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="重试次数">第 {ticket.retryCount} 次</Descriptions.Item>
                <Descriptions.Item label="下次自动重试">
                  {ticket.retryAt == null
                    ? '等待调度'
                    : `${formatTime(ticket.retryAt)}（${
                        ticket.retryAt > now ? `剩余 ${formatDuration(ticket.retryAt - now)}` : '即将重试'
                      }）`}
                </Descriptions.Item>
              </Descriptions>
              {ticket.blockReason != null && (
                <Typography.Paragraph
                  type="secondary"
                  style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
                  ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}
                >
                  {ticket.blockReason}
                </Typography.Paragraph>
              )}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                worker 报告缺失/校验失败将自动退避重试（60/120/240 秒）；达重试上限自动升级为人工卡点，届时再行裁决。
              </Typography.Text>
            </Space>
          </Card>
        )}
        {ticket.status === 'BLOCKED' && ticket.pendingLabel !== 'agent' && (
          <BlockedResolutionCard ticket={ticket} onChanged={() => reload()} />
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
