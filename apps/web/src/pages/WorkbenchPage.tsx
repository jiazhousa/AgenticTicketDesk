import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Input, List, Modal, Space, Spin, Tag, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import {
  listTickets,
  submitSpec,
  transitionTicket,
} from '../api/tickets';
import type { Ticket, TicketListItem } from '../api/types';
import StatusLight from '../components/StatusLight';
import StatusTag, { TypeTag, statusLabel } from '../components/StatusTag';
import BlockedResolutionCard from '../components/BlockedResolutionCard';
import DispatchForm from '../components/DispatchForm';
import CreateTicketModal from '../components/CreateTicketModal';
import QueuedTag from '../components/QueuedTag';
import RepoRefTag from '../components/RepoRefTag';
import { formatDuration, formatTime } from '../utils/format';
import { useInterval, useNow } from '../utils/hooks';
import { useWorkspace } from '../context/WorkspaceContext';
import { useWorkspaceMap } from '../utils/workspace';

/** 工作台轮询间隔 */
const POLL_MS = 10000;

/**
 * 工作台（默认首页）= 人需要关注的内容，三区：
 * ① 新建单入口（弹窗含 TASK 预绑定 worker）
 * ② 阻塞区：BLOCKED 工单按卡点层级分流——l3 人工裁决（弹裁决卡直接处理）；
 *    agent（RETRY_WAIT）系统自动重试中（只读：次数+倒计时，无需人工处理）
 * ③ 待处理区：DRAFT / SPEC_READY 单，附「提交 spec / 放行」快捷操作；
 *    排队单（SPEC_READY+queuedReason）显示排队徽标、隐藏人工放行入口（系统自动放行）
 */
export default function WorkbenchPage() {
  // 顶栏切换器所选 workspace（null=全部）；切换即触发下方 load 重建重拉
  const { workspaceId } = useWorkspace();
  const workspaceMap = useWorkspaceMap();
  // 阻塞区数据（status=BLOCKED 一次拉全；blockReason 内联于列表项，无需逐单拉详情）
  const [blockedItems, setBlockedItems] = useState<TicketListItem[] | null>(null);
  // 待处理区数据
  const [draftItems, setDraftItems] = useState<TicketListItem[] | null>(null);
  const [readyItems, setReadyItems] = useState<TicketListItem[] | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  // 快捷操作弹窗：null 关闭；{kind:'spec',ticket} 提交 spec；{kind:'release-story',ticket} STORY 放行备注
  const [action, setAction] = useState<null | { kind: 'spec' | 'release-story'; ticket: Ticket }>(null);
  const [specContent, setSpecContent] = useState('');
  // 计划改动文件声明文本（每行一个路径；随 submitSpec 提交冻结）
  const [plannedFilesText, setPlannedFilesText] = useState('');
  const [releaseNote, setReleaseNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // TASK 放行弹层（DispatchForm 自管 worker 选择）
  const [dispatchTicket, setDispatchTicket] = useState<Ticket | null>(null);
  // 卡点裁决弹层目标（BLOCKED 原单）
  const [resolveTarget, setResolveTarget] = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    // workspaceId 不传=全量（「全部」视图）；三区同过滤口径
    const [blocked, draft, ready] = await Promise.all([
      listTickets({ status: 'BLOCKED', workspaceId: workspaceId ?? undefined }).catch(() => ({ items: [] as TicketListItem[] })),
      listTickets({ status: 'DRAFT', workspaceId: workspaceId ?? undefined }).catch(() => ({ items: [] as TicketListItem[] })),
      listTickets({ status: 'SPEC_READY', workspaceId: workspaceId ?? undefined }).catch(() => ({ items: [] as TicketListItem[] })),
    ]);
    setBlockedItems(blocked.items);
    setDraftItems(draft.items);
    setReadyItems(ready.items);
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useInterval(() => void load(), POLL_MS);

  async function refreshAfterAction() {
    await load();
  }

  async function handleSpecSubmit() {
    if (action?.kind !== 'spec') return;
    const content = specContent.trim();
    if (content === '') return;
    setSubmitting(true);
    try {
      // 每行一个路径，空行忽略；空声明不发送（server 视空数组同未声明，此处直接省字段）
      const files = plannedFilesText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      await submitSpec(action.ticket.id, content, files.length > 0 ? files : undefined);
      setAction(null);
      await refreshAfterAction();
    } catch {
      // 错误已由 api 层统一 toast
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStoryRelease() {
    if (action?.kind !== 'release-story') return;
    setSubmitting(true);
    try {
      const note = releaseNote.trim();
      await transitionTicket(action.ticket.id, 'DISPATCHED', note === '' ? undefined : note);
      setAction(null);
      await refreshAfterAction();
    } catch {
      // 错误已由 api 层统一 toast
    } finally {
      setSubmitting(false);
    }
  }

  const loading = blockedItems == null || draftItems == null || readyItems == null;
  const blockedTickets = blockedItems ?? [];
  const readyTasks = (readyItems ?? []).filter((t) => t.type !== 'DREAM');
  const drafts = (draftItems ?? []).filter((t) => t.type !== 'DREAM');
  // RETRY_WAIT 倒计时跳动的当前时刻（存在 agent 态阻塞单才启用，避免空转重渲染）
  const now = useNow(blockedTickets.some((t) => t.pendingLabel === 'agent'));

  return (
    <div style={{ padding: 24, maxWidth: 1080, margin: '0 auto' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 页头 + 新建单入口 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            工作台
            <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400, marginLeft: 12 }}>
              需要你关注的事：阻塞待裁决、待处理单
            </Typography.Text>
          </Typography.Title>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新建工单
            </Button>
          </Space>
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin tip="加载中…" />
          </div>
        ) : (
          <>
            {/* 阻塞区：最高优先展示——卡点内联于原单，看到即可直接裁决 */}
            <Card
              title={
                <Space>
                  <span>阻塞与待裁决</span>
                  {blockedTickets.length > 0 && <Badge count={blockedTickets.length} color="#ff4d4f" />}
                </Space>
              }
              style={{ borderColor: blockedTickets.length > 0 ? '#ffa39e' : undefined }}
            >
              {blockedTickets.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无阻塞单——一切顺畅" />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  {blockedTickets.map((task) => (
                    <div key={task.id}>
                      <Space style={{ marginBottom: 4 }} wrap>
                        <StatusLight status={task.status} />
                        <TypeTag type={task.type} />
                        <Link to={`/tickets/${task.id}`}>
                          <Typography.Text strong>
                            #{task.id} {task.title}
                          </Typography.Text>
                        </Link>
                        {task.workerId != null && (
                          <Tag style={{ marginInlineEnd: 0 }}>{task.workerId}</Tag>
                        )}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          阻塞于 {formatTime(task.updatedAt)}
                        </Typography.Text>
                        {task.pendingLabel === 'agent' ? (
                          // RETRY_WAIT 自动重试：只读信息（次数+倒计时），不渲染裁决按钮
                          <Space size={4} wrap>
                            <Tag color="processing" style={{ marginInlineEnd: 0 }}>
                              自动重试
                            </Tag>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              第 {task.retryCount} 次重试等待中 ·{' '}
                              {task.retryAt == null
                                ? '等待调度'
                                : task.retryAt > now
                                  ? `${formatDuration(task.retryAt - now)}后自动重跑`
                                  : '即将自动重跑'}{' '}
                              · 无需人工处理
                            </Typography.Text>
                          </Space>
                        ) : (
                          <Button size="small" type="primary" onClick={() => setResolveTarget(task)}>
                            裁决
                          </Button>
                        )}
                      </Space>
                      {task.blockReason != null ? (
                        // 卡点原因摘要：两行截断+展开（全文裁决依据在裁决卡内等宽引用块展示）
                        <Typography.Paragraph
                          type="secondary"
                          style={{ marginBottom: 0, paddingLeft: 4, fontSize: 12 }}
                          ellipsis={{ rows: 2, expandable: true, symbol: '展开' }}
                        >
                          {task.blockReason}
                        </Typography.Paragraph>
                      ) : (
                        // 契约上 BLOCKED 恒有 blockReason；缺失属数据异常
                        <Alert
                          type="warning"
                          showIcon
                          message={
                            <>
                              未见卡点原因——请到 <Link to={`/tickets/${task.id}`}>详情页</Link> 查看转移历史与留言定位原因。
                            </>
                          }
                        />
                      )}
                    </div>
                  ))}
                </Space>
              )}
            </Card>

            {/* 待处理区：DRAFT / SPEC_READY */}
            <Card title={<Space><span>待处理</span><Badge count={drafts.length + readyTasks.length} color="#1677ff" /></Space>}>
              {drafts.length + readyTasks.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无待处理单" />
              ) : (
                <List
                  size="small"
                  dataSource={[...drafts, ...readyTasks]}
                  rowKey={(t) => `${t.status}-${t.id}`}
                  renderItem={(t) => (
                    <List.Item
                      style={{ padding: '8px 0' }}
                      actions={[
                        t.status === 'DRAFT' ? (
                          <Button
                            key="spec"
                            size="small"
                            onClick={() => {
                              setSpecContent(t.specContent ?? '');
                              setPlannedFilesText('');
                              setAction({ kind: 'spec', ticket: t });
                            }}
                          >
                            提交 spec
                          </Button>
                        ) : t.status === 'SPEC_READY' && t.queuedReason != null ? (
                          // 排队单：前序执行释放后系统自动放行，隐藏人工放行入口（徽标在行内容区展示）
                          <Typography.Text key="queued" type="secondary" style={{ fontSize: 12 }}>
                            排队中·自动放行
                          </Typography.Text>
                        ) : t.type === 'TASK' ? (
                          <Button key="release" size="small" type="primary" onClick={() => setDispatchTicket(t)}>
                            放行
                          </Button>
                        ) : (
                          <Button
                            key="release"
                            size="small"
                            type="primary"
                            onClick={() => {
                              setReleaseNote('');
                              setAction({ kind: 'release-story', ticket: t });
                            }}
                          >
                            放行
                          </Button>
                        ),
                        <Link key="detail" to={`/tickets/${t.id}`}>
                          <Button size="small" type="text">
                            详情
                          </Button>
                        </Link>,
                      ]}
                    >
                      <Space wrap>
                        <StatusLight status={t.status} />
                        <StatusTag status={t.status} />
                        <TypeTag type={t.type} />
                        <Link to={`/tickets/${t.id}`}>
                          #{t.id} {t.title}
                        </Link>
                        <RepoRefTag ticket={t} workspaceMap={workspaceMap} />
                        {t.status === 'SPEC_READY' && t.queuedReason != null && <QueuedTag ticket={t} />}
                        {t.parentId != null && (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            父单 <Link to={`/tickets/${t.parentId}`}>#{t.parentId}</Link>
                          </Typography.Text>
                        )}
                        {t.type === 'TASK' && t.workerId == null && t.status === 'SPEC_READY' && (
                          <Tag color="warning" style={{ marginInlineEnd: 0 }}>
                            放行时需选 worker
                          </Tag>
                        )}
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </>
        )}
      </Space>

      {/* 新建单弹窗（TASK 支持预绑定 worker） */}
      <CreateTicketModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => void load()} />

      {/* 提交 spec 弹窗（DRAFT 快捷操作） */}
      <Modal
        title={action?.kind === 'spec' ? `提交 spec —— #${action.ticket.id} ${action.ticket.title}` : '提交 spec'}
        open={action?.kind === 'spec'}
        confirmLoading={submitting}
        okText="提交并冻结"
        cancelText="取消"
        okButtonProps={{ disabled: specContent.trim() === '' }}
        onOk={handleSpecSubmit}
        onCancel={() => setAction(null)}
      >
        <Typography.Paragraph type="secondary">
          提交后工单转入「{statusLabel('SPEC_READY')}」，spec 快照冻结不可再改（后续变更走变更单）。
        </Typography.Paragraph>
        <Input.TextArea
          rows={10}
          value={specContent}
          onChange={(e) => setSpecContent(e.target.value)}
          placeholder="填写 spec 快照内容（必填）"
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 4 }}>
          计划改动文件（可选）：放行前与同仓在途单做文件集冲突检测的依据。
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          value={plannedFilesText}
          onChange={(e) => setPlannedFilesText(e.target.value)}
          placeholder={'每行一个相对仓库路径；尾斜杠=目录递归包含\n如：apps/web/src/api/types.ts\n如：packages/worker-core/'}
        />
      </Modal>

      {/* STORY 放行弹窗（纯编排不绑 worker，备注可选） */}
      <Modal
        title={action?.kind === 'release-story' ? `放行 —— #${action.ticket.id} ${action.ticket.title}` : '放行'}
        open={action?.kind === 'release-story'}
        confirmLoading={submitting}
        okText="放行"
        cancelText="取消"
        onOk={handleStoryRelease}
        onCancel={() => setAction(null)}
      >
        <Typography.Paragraph type="secondary">
          STORY 为纯编排单：放行后进入进行中，由人工推进各子单；子单全部完成后方可关单。
        </Typography.Paragraph>
        <Input
          value={releaseNote}
          onChange={(e) => setReleaseNote(e.target.value)}
          placeholder="放行备注（可选，会记入时间线）"
        />
      </Modal>

      {/* TASK 放行弹层（选 worker） */}
      {dispatchTicket != null && (
        <DispatchForm
          ticket={dispatchTicket}
          open
          onClose={() => setDispatchTicket(null)}
          onChanged={() => {
            setDispatchTicket(null);
            void refreshAfterAction();
          }}
        />
      )}

      {/* 卡点裁决弹层（BLOCKED 原单直接裁决：继续/改派/终止） */}
      <Modal
        title={resolveTarget != null ? `卡点裁决 —— #${resolveTarget.id} ${resolveTarget.title}` : '卡点裁决'}
        open={resolveTarget != null}
        footer={null}
        onCancel={() => setResolveTarget(null)}
        width={680}
        destroyOnClose
      >
        {resolveTarget != null && (
          <BlockedResolutionCard
            ticket={resolveTarget}
            onChanged={() => {
              setResolveTarget(null);
              void refreshAfterAction();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
