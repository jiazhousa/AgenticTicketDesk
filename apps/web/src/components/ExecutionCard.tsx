import { useState } from 'react';
import { Button, Card, Checkbox, Descriptions, Modal, Space, Typography } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { reclaimWorktree } from '../api/tickets';
import type { Ticket, TicketExecution, TicketTransition } from '../api/types';
import StatusLight from './StatusLight';
import StatusTag from './StatusTag';
import { formatDuration, formatTime } from '../utils/format';
import { useNow } from '../utils/hooks';

/**
 * 执行卡（详情页瘦身版）：只保留 人需要看的执行要素——状态/worker/轮次/时长 + 「查看日志」入口。
 * 原始事件流不在详情页展示（独立日志页 /tickets/:id/logs，类 CI job 视图）。
 * 时长口径：执行中=当前轮已运行时长（实时跳动）；已结束=最近一轮 进入执行→落定 的时长
 * （由转移历史推算，L2 同态重试轮不产生转移记录，时长含在同轮内）；从未执行显示「未执行」。
 */
export default function ExecutionCard({
  ticket,
  workerName,
  execution,
  transitions,
  onChanged,
}: {
  ticket: Ticket;
  workerName: string | null;
  execution: TicketExecution | null;
  transitions: TicketTransition[];
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const running = execution != null;
  // 执行中每秒跳动刷新耗时
  const now = useNow(running);

  // 最近一轮时长：最后一次进入 IN_PROGRESS → 其后首条转移（落定）的时间差
  let lastRoundDurationMs: number | null = null;
  let lastRoundStartAt: number | null = null;
  if (!running && transitions.length > 0) {
    const ordered = [...transitions].sort((a, b) => a.createdAt - b.createdAt);
    let enterIdx = -1;
    for (let i = ordered.length - 1; i >= 0; i--) {
      if (ordered[i].toStatus === 'IN_PROGRESS') {
        enterIdx = i;
        break;
      }
    }
    if (enterIdx >= 0) {
      lastRoundStartAt = ordered[enterIdx].createdAt;
      // 落定时间=进入执行后的首条转移；若尚无后续转移（防御），回退 updatedAt
      const settle = ordered[enterIdx + 1];
      lastRoundDurationMs = (settle?.createdAt ?? ticket.updatedAt) - lastRoundStartAt;
    }
  }

  const terminal = ticket.status === 'DONE' || ticket.status === 'CANCELLED' || ticket.status === 'FAILED';

  return (
    <Card
      title={
        <Space>
          <span>执行</span>
          <StatusLight status={ticket.status} />
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<FileTextOutlined />}
            disabled={ticket.round < 1}
            onClick={() => navigate(`/tickets/${ticket.id}/logs`)}
          >
            查看日志
          </Button>
          <ReclaimButton ticket={ticket} disabled={!terminal} onChanged={onChanged} />
        </Space>
      }
    >
      <Descriptions column={{ xs: 1, sm: 2, md: 4 }} size="small">
        <Descriptions.Item label="状态">
          <Space>
            <StatusLight status={ticket.status} />
            <StatusTag status={ticket.status} />
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="worker">
          {workerName ?? ticket.workerId ?? (
            <Typography.Text type="secondary">（未绑定）</Typography.Text>
          )}
          {workerName != null && ticket.workerId != null && workerName !== ticket.workerId && (
            <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
              ({ticket.workerId})
            </Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="轮次">第 {ticket.round} 轮</Descriptions.Item>
        <Descriptions.Item label="时长">
          {running && execution ? (
            <Typography.Text type="warning">{formatDuration(now - execution.startedAt)}</Typography.Text>
          ) : lastRoundDurationMs != null ? (
            formatDuration(lastRoundDurationMs)
          ) : (
            <Typography.Text type="secondary">未执行</Typography.Text>
          )}
        </Descriptions.Item>
        {running && execution && (
          <Descriptions.Item label="本轮启动">{formatTime(execution.startedAt)}</Descriptions.Item>
        )}
        {!running && lastRoundStartAt != null && (
          <Descriptions.Item label="上轮启动">{formatTime(lastRoundStartAt)}</Descriptions.Item>
        )}
      </Descriptions>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        执行过程的事件流见 <Link to={`/tickets/${ticket.id}/logs`}>日志页</Link>（轮次选择 + 全量事件流）。
      </Typography.Text>
    </Card>
  );
}

/** worktree 回收入口：仅终态可用（执行中/非终态由 server 422 WORKTREE_ACTIVE 拒） */
function ReclaimButton({ ticket, disabled, onChanged }: { ticket: Ticket; disabled: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [keepBranch, setKeepBranch] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  if (disabled) {
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
