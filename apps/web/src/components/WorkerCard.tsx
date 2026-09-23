import { useEffect, useRef, useState } from 'react';
import { Button, Card, Checkbox, Descriptions, Modal, Select, Space, Tag, Typography } from 'antd';
import { getLogs, reclaimWorktree } from '../api/tickets';
import type { LogsResponse, Ticket, TicketExecution, UnifiedEvent } from '../api/types';
import { formatTime } from '../utils/format';

/** 事件流尾部展示条数（与 impl §5 一致） */
const LOG_TAIL = 30;
/** 执行中轮询间隔 */
const POLL_INTERVAL_MS = 5000;
/** 轮询发现 finish 后延迟刷新详情（等待 server 结算转移，通常秒内完成） */
const FINISH_RELOAD_DELAY_MS = 2000;

/**
 * 执行卡（TASK 绑定 worker 后展示）：worker 档案/轮次/启动时间 + 事件流尾部。
 * - 当前轮执行中 5s 轮询（tail=30）；查看历史轮次时仅单次拉取不轮询
 * - 事件只展示文本与工具名，不展开参数（spec §5）
 * - 轮询发现 finish 事件 → 延迟触发 onChanged（详情重载拿终态与报告）
 * - 终态提供 worktree 回收入口（keepBranch 默认保留分支与 commit）
 */
export default function WorkerCard({
  ticket,
  workerName,
  execution,
  onChanged,
}: {
  ticket: Ticket;
  workerName: string | null;
  execution: TicketExecution | null;
  onChanged: () => void;
}) {
  // 查看轮次：默认跟随当前轮（新轮开启时自动跟随）
  const [selectedRound, setSelectedRound] = useState<number>(ticket.round);
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // onChanged 引用随详情重载变化，入 ref 防 effect 依赖抖动
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    setSelectedRound(ticket.round);
  }, [ticket.round]);

  const running = execution != null;
  const viewingCurrent = selectedRound === ticket.round;
  // round=0 表示从未执行（无日志可查）；防御性允许 0 时不请求
  const hasRound = selectedRound >= 1;

  useEffect(() => {
    if (!hasRound) {
      setLogs(null);
      return;
    }
    let cancelled = false;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;

    const fetchLogs = async () => {
      try {
        const res = await getLogs(ticket.id, { round: selectedRound, tail: LOG_TAIL });
        if (cancelled) return;
        setLogs(res);
        setLogError(null);
        // 轮询中看到 finish：本轮进程已退出，稍候刷新详情拿结算终态
        if (running && viewingCurrent && res.events.some((ev) => ev.type === 'finish')) {
          reloadTimer = setTimeout(() => {
            if (!cancelled) onChangedRef.current();
          }, FINISH_RELOAD_DELAY_MS);
        }
      } catch (e) {
        if (cancelled) return;
        // 静默失败（getLogs 不弹全局 toast），行内展示
        setLogError(e instanceof Error ? e.message : '日志加载失败');
      }
    };

    void fetchLogs();
    let timer: ReturnType<typeof setInterval> | undefined;
    if (running && viewingCurrent) {
      timer = setInterval(fetchLogs, POLL_INTERVAL_MS);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (reloadTimer) clearTimeout(reloadTimer);
    };
  }, [ticket.id, selectedRound, running, viewingCurrent, hasRound]);

  // 新事件到达自动滚到底部
  useEffect(() => {
    const el = logContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <Card
      title="执行"
      extra={<ReclaimButton ticket={ticket} onChanged={onChanged} />}
    >
      <Descriptions column={{ xs: 1, sm: 3 }} size="small">
        <Descriptions.Item label="worker">
          {workerName ?? ticket.workerId ?? '（未知）'}
          {workerName != null && ticket.workerId != null && workerName !== ticket.workerId && (
            <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
              ({ticket.workerId})
            </Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="轮次">
          <Space>
            <span>{ticket.round}</span>
            {ticket.round >= 2 && (
              <Select
                size="small"
                style={{ width: 110 }}
                value={selectedRound}
                onChange={setSelectedRound}
                options={Array.from({ length: ticket.round }, (_, i) => ({
                  value: i + 1,
                  label: `第 ${i + 1} 轮${i + 1 === ticket.round ? '（当前）' : ''}`,
                }))}
              />
            )}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="本轮启动">
          {execution ? (
            <span>
              {formatTime(execution.startedAt)}
              {running && viewingCurrent && (
                <Tag color="orange" style={{ marginLeft: 6 }}>
                  执行中
                </Tag>
              )}
            </span>
          ) : (
            <Typography.Text type="secondary">—（未在执行）</Typography.Text>
          )}
        </Descriptions.Item>
      </Descriptions>

      <div
        ref={logContainerRef}
        style={{
          marginTop: 8,
          maxHeight: 280,
          overflow: 'auto',
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 4,
          padding: '8px 12px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.8,
        }}
      >
        {logError ? (
          <Typography.Text type="danger">{logError}</Typography.Text>
        ) : logs == null ? (
          <Typography.Text type="secondary">暂无执行日志</Typography.Text>
        ) : logs.events.length === 0 ? (
          <Typography.Text type="secondary">
            第 {logs.round} 轮暂无事件{running && viewingCurrent ? '（等待 worker 输出…）' : ''}
          </Typography.Text>
        ) : (
          logs.events.map((ev, idx) => <EventLine key={idx} event={ev} />)
        )}
      </div>
      {logs != null && logs.events.length > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
          第 {logs.round} 轮事件尾部（最近 {logs.events.length} 条
          {running && viewingCurrent ? `，每 ${POLL_INTERVAL_MS / 1000}s 刷新` : ''}）
        </Typography.Text>
      )}
    </Card>
  );
}

/** 单条事件渲染：文本与工具名，不展开参数 */
function EventLine({ event }: { event: UnifiedEvent }) {
  switch (event.type) {
    case 'text-delta':
      return <div style={{ whiteSpace: 'pre-wrap' }}>{event.text ?? ''}</div>;
    case 'tool-call':
      return (
        <div>
          <Tag color="processing">工具 {event.tool ?? '?'}</Tag>
        </div>
      );
    case 'tool-result':
      return (
        <div>
          <Tag color={event.errored ? 'error' : 'default'}>
            {event.errored ? '工具失败' : '工具完成'} {event.tool ?? '?'}
          </Tag>
        </div>
      );
    case 'turn-start':
      return (
        <div>
          <Typography.Text type="secondary">—— 回合开始 ——</Typography.Text>
        </div>
      );
    case 'turn-end':
      return (
        <div>
          <Typography.Text type="secondary">—— 回合结束 ——</Typography.Text>
        </div>
      );
    case 'finish':
      return (
        <div>
          <Tag color="green">执行结束</Tag>
        </div>
      );
    default:
      // text-start/text-end 及后续扩展类型：无展示价值，跳过
      return null;
  }
}

/** worktree 回收入口：仅终态可用（执行中/非终态由 server 422 WORKTREE_ACTIVE 拒） */
function ReclaimButton({ ticket, onChanged }: { ticket: Ticket; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [keepBranch, setKeepBranch] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const terminal = ticket.status === 'DONE' || ticket.status === 'CANCELLED' || ticket.status === 'FAILED';

  if (!terminal) {
    // 非终态（含 BLOCKED 等待裁决——worktree 待复用）不提供回收
    return null;
  }

  async function handleOk() {
    setSubmitting(true);
    try {
      await reclaimWorktree(ticket.id, keepBranch);
      setOpen(false);
      onChanged();
    } catch {
      // 错误已由 api 层统一 toast（WORKTREE_ACTIVE 等）
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        回收 worktree
      </Button>
      <Modal
        title={`回收 worktree —— #${ticket.id}`}
        open={open}
        confirmLoading={submitting}
        okText="回收"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        onOk={handleOk}
        onCancel={() => setOpen(false)}
      >
        <Typography.Paragraph type="secondary">
          删除该工单的 worktree 工作目录（位于 ATD 管理目录，不动目标仓文件）。commit 关联记录不受影响。
        </Typography.Paragraph>
        <Checkbox checked={keepBranch} onChange={(e) => setKeepBranch(e.target.checked)}>
          保留分支 atd/t{ticket.id}（连同其上的 commit；取消勾选则分支与 commit 一并删除）
        </Checkbox>
      </Modal>
    </>
  );
}
