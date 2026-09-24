import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Alert, Button, Card, Input, Modal, Select, Space, Typography } from 'antd';
import { getWorkers, resolveTicket } from '../api/tickets';
import type { ResolveTicketRequest, Ticket, WorkerInfo } from '../api/types';

type Resolution = ResolveTicketRequest['resolution'];

/** 卡点原因引用块样式：等宽字体 + 左侧红边，全文呈现（这是用户的裁决决策依据） */
const REASON_BLOCK_STYLE: CSSProperties = {
  margin: 0,
  padding: '8px 12px',
  background: '#fafafa',
  borderLeft: '3px solid #ffa39e',
  borderRadius: 2,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  fontSize: 12,
  lineHeight: 1.7,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/**
 * 阻塞裁决卡（内联卡点语义：卡点=原单 BLOCKED 状态，无独立卡点单）。
 * 两个消费视角：
 * - 详情页：BLOCKED 态内嵌展示（卡4）
 * - 工作台阻塞区：Modal 弹层内复用（点「裁决」弹出）
 * 三裁决直通 POST /api/tickets/:id/resolve（id=本单）：
 * - 继续（primary）：原 worktree 换轮重跑
 * - 改派（default）：复用 worktree 换新 worker（首次点击展开 worker 选择，选定后再执行）
 * - 终止（danger）：本单 FAILED 终态不可恢复，二次确认
 * 裁决 note 落本单留言时间线；成功后回调 onChanged 刷新。
 */
export default function BlockedResolutionCard({
  ticket,
  onChanged,
}: {
  ticket: Ticket;
  onChanged: () => void;
}) {
  const [note, setNote] = useState('');
  const [reassignWorkerId, setReassignWorkerId] = useState<string | undefined>();
  // worker 列表懒加载：仅在用户首次点「改派」时拉取 Registry（继续/终止用不到）；失败后重开弹层重试
  const [workerSelectShown, setWorkerSelectShown] = useState(false);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [workersLoaded, setWorkersLoaded] = useState(false);
  const [submitting, setSubmitting] = useState<Resolution | null>(null);

  function ensureWorkers() {
    if (workersLoading || workersLoaded) return;
    setWorkersLoaded(true);
    setWorkersLoading(true);
    getWorkers()
      .then(setWorkers)
      .catch(() => {
        // 错误已由 api 层统一 toast；下方 Alert 提示可改选其他裁决方式
      })
      .finally(() => setWorkersLoading(false));
  }

  async function submit(resolution: Resolution) {
    const req: ResolveTicketRequest = { resolution };
    const trimmed = note.trim();
    if (trimmed !== '') req.note = trimmed;
    if (resolution === 'reassign') {
      if (reassignWorkerId == null) return;
      req.reassignWorkerId = reassignWorkerId;
    }
    setSubmitting(resolution);
    try {
      await resolveTicket(ticket.id, req);
      onChanged();
    } catch {
      // 错误已由 api 层统一 toast（RESOLUTION_INVALID / WORKER_REQUIRED / WORKER_UNKNOWN）
    } finally {
      setSubmitting(null);
    }
  }

  function handleReassign() {
    // 首次点击：展开 worker 选择区（不提交）；选定后再点执行
    if (!workerSelectShown) {
      setWorkerSelectShown(true);
      ensureWorkers();
      return;
    }
    if (reassignWorkerId == null) return;
    void submit('reassign');
  }

  function handleAbort() {
    Modal.confirm({
      title: `终止工单 #${ticket.id}`,
      content: '终止后工单进入失败终态（FAILED），不可恢复。确定终止吗？',
      okText: '终止',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => submit('abort'),
    });
  }

  return (
    <Card title="卡点裁决" style={{ borderColor: '#ffa39e' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 卡点原因全文：等宽引用块（用户决策依据，不截断） */}
        {ticket.blockReason != null ? (
          <div>
            <Typography.Text type="secondary">卡点原因（全文）：</Typography.Text>
            <div style={REASON_BLOCK_STYLE}>{ticket.blockReason}</div>
          </div>
        ) : (
          // 契约上 BLOCKED 恒有 blockReason（编排层两条置位路径均落值）；缺失属数据异常
          <Alert type="warning" showIcon message="未见卡点原因——请查看转移历史与留言定位原因。" />
        )}

        <div>
          <Typography.Text type="secondary">裁决留言（可选，记入本单留言）：</Typography.Text>
          <Input.TextArea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="结论与处置说明（可选）"
          />
        </div>

        {workerSelectShown && (
          <div>
            <Typography.Text type="secondary">改派给：</Typography.Text>
            <Select
              style={{ minWidth: 280, width: '100%' }}
              loading={workersLoading}
              value={reassignWorkerId}
              placeholder="选择新 worker（选定后再点「改派 worker」执行）"
              onChange={setReassignWorkerId}
              options={workers.map((w) => ({
                value: w.id,
                label: `${w.name}（${w.protocol} · ${w.capabilities.join(' / ')}）`,
              }))}
            />
            {workers.length === 0 && !workersLoading && (
              <Alert
                type="error"
                showIcon
                style={{ marginTop: 8 }}
                message="worker 列表为空或加载失败：无法改派（可改选其他裁决方式）"
              />
            )}
          </div>
        )}

        <Space wrap>
          <Button type="primary" loading={submitting === 'continue'} onClick={() => void submit('continue')}>
            继续执行
          </Button>
          <Button
            loading={submitting === 'reassign'}
            disabled={workerSelectShown && reassignWorkerId == null}
            onClick={handleReassign}
          >
            改派 worker
          </Button>
          <Button danger loading={submitting === 'abort'} onClick={handleAbort}>
            终止
          </Button>
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          继续=原 worktree 换轮重跑；改派=复用 worktree 换新 worker；终止=本单转失败终态（不可恢复）。
        </Typography.Text>
      </Space>
    </Card>
  );
}
