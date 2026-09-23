import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Empty, Input, List, Modal, Space, Spin, Tag, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import {
  getTicket,
  listTickets,
  submitSpec,
  transitionTicket,
} from '../api/tickets';
import type { Ticket, TicketDetail, TicketListItem } from '../api/types';
import StatusLight from '../components/StatusLight';
import StatusTag, { TypeTag, statusLabel } from '../components/StatusTag';
import BlockerCard from '../components/BlockerCard';
import DispatchForm from '../components/DispatchForm';
import CreateTicketModal from '../components/CreateTicketModal';
import { formatTime } from '../utils/format';
import { useInterval } from '../utils/hooks';

/** 工作台轮询间隔 */
const POLL_MS = 10000;

/**
 * 工作台（默认首页）= 人需要关注的内容，三区：
 * ① 新建单入口（弹窗含 TASK 预绑定 worker）
 * ② 阻塞区：BLOCKED 工单 + 待裁决 BLOCKER 卡（最高优先展示）
 * ③ 待处理区：DRAFT / SPEC_READY 单，附「提交 spec / 放行」快捷操作
 */
export default function WorkbenchPage() {
  // 阻塞区数据（status=BLOCKED 一次拉全，前端按类型分流）
  const [blockedItems, setBlockedItems] = useState<TicketListItem[] | null>(null);
  const [blockedDetails, setBlockedDetails] = useState<Map<number, TicketDetail>>(new Map());
  // 阻塞 TASK 详情失败时兜底展示列表行；BLOCKER 孤儿（无配对父单）单独展示
  const [orphanBlockers, setOrphanBlockers] = useState<TicketListItem[]>([]);
  // 待处理区数据
  const [draftItems, setDraftItems] = useState<TicketListItem[] | null>(null);
  const [readyItems, setReadyItems] = useState<TicketListItem[] | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  // 快捷操作弹窗：null 关闭；{kind:'spec',ticket} 提交 spec；{kind:'release-story',ticket} STORY 放行备注
  const [action, setAction] = useState<null | { kind: 'spec' | 'release-story'; ticket: Ticket }>(null);
  const [specContent, setSpecContent] = useState('');
  const [releaseNote, setReleaseNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // TASK 放行弹层（DispatchForm 自管 worker 选择）
  const [dispatchTicket, setDispatchTicket] = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    const [blocked, draft, ready] = await Promise.all([
      listTickets({ status: 'BLOCKED' }).catch(() => ({ items: [] as TicketListItem[] })),
      listTickets({ status: 'DRAFT' }).catch(() => ({ items: [] as TicketListItem[] })),
      listTickets({ status: 'SPEC_READY' }).catch(() => ({ items: [] as TicketListItem[] })),
    ]);
    setBlockedItems(blocked.items);
    setDraftItems(draft.items);
    setReadyItems(ready.items);

    // 阻塞区配对：每个 BLOCKED TASK 拉详情（取关联 BLOCKER 与卡点说明）；失败降级为纯列表行
    const blockedTasks = blocked.items.filter((t) => t.type !== 'BLOCKER');
    const blockerTickets = blocked.items.filter((t) => t.type === 'BLOCKER');
    const details = await Promise.all(
      blockedTasks.map((t) => getTicket(t.id).catch(() => null)),
    );
    const map = new Map<number, TicketDetail>();
    const pairedBlockerIds = new Set<number>();
    details.forEach((d, i) => {
      if (d) {
        map.set(blockedTasks[i].id, d);
        if (d.blocker != null) pairedBlockerIds.add(d.blocker.id);
      }
    });
    setBlockedDetails(map);
    setOrphanBlockers(blockerTickets.filter((b) => !pairedBlockerIds.has(b.id)));
  }, []);

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
      await submitSpec(action.ticket.id, content);
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
  const blockedTasks = (blockedItems ?? []).filter((t) => t.type !== 'BLOCKER');
  const readyTasks = (readyItems ?? []).filter((t) => t.type !== 'BLOCKER' && t.type !== 'DREAM');
  const drafts = (draftItems ?? []).filter((t) => t.type !== 'BLOCKER' && t.type !== 'DREAM');

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
            {/* 阻塞区：最高优先展示 */}
            <Card
              title={
                <Space>
                  <span>阻塞与待裁决</span>
                  {blockedTasks.length + orphanBlockers.length > 0 && (
                    <Badge count={blockedTasks.length + orphanBlockers.length} color="#ff4d4f" />
                  )}
                </Space>
              }
              style={{ borderColor: blockedTasks.length + orphanBlockers.length > 0 ? '#ffa39e' : undefined }}
            >
              {blockedTasks.length === 0 && orphanBlockers.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无阻塞单——一切顺畅" />
              ) : (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  {blockedTasks.map((task) => {
                    const detail = blockedDetails.get(task.id);
                    return (
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
                        </Space>
                        {detail?.blocker != null ? (
                          <BlockerCard
                            blocker={detail.blocker}
                            blockReason={detail.report?.blockReason ?? null}
                            compact
                            onChanged={() => void refreshAfterAction()}
                          />
                        ) : (
                          <Alert
                            type="warning"
                            showIcon
                            message={
                              <>
                                未见关联卡点单——请到 <Link to={`/tickets/${task.id}`}>详情页</Link> 查看转移历史与留言定位原因。
                              </>
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                  {orphanBlockers.map((b) => (
                    <BlockerCard
                      key={b.id}
                      blocker={b}
                      blockReason={null}
                      compact
                      onChanged={() => void refreshAfterAction()}
                    />
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
                              setAction({ kind: 'spec', ticket: t });
                            }}
                          >
                            提交 spec
                          </Button>
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
    </div>
  );
}
