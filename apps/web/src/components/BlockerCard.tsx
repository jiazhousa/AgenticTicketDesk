import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Radio, Select, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { getWorkers, resolveBlocker } from '../api/tickets';
import type { ResolveBlockerRequest, Ticket, WorkerInfo } from '../api/types';
import StatusTag from './StatusTag';

type Resolution = ResolveBlockerRequest['resolution'];

/** 裁决三选文案 */
const RESOLUTION_OPTIONS: { value: Resolution; label: string; description: string }[] = [
  { value: 'continue', label: '继续', description: '复用原 worktree，换轮次重新派发给当前 worker' },
  { value: 'reassign', label: '改派', description: '复用原 worktree（分支与半成品保留），换新 worker 重新执行' },
  { value: 'abort', label: '终止', description: '父单转失败（FAILED），不再执行' },
];

/**
 * 卡点处理卡：BLOCKER 单入口 + 裁决弹层。
 * 两个消费视角：
 * - 父单（BLOCKED 态）详情页：传 detail.blocker，卡内提供 BLOCKER 单入口
 * - BLOCKER 单自身详情页：传 ticket 自身 + parentTicketId，卡内提供父单入口
 * 裁决提交 → POST /resolve：note 落 BLOCKER 留言 → BLOCKER 关单 → 按裁决转父单。
 */
export default function BlockerCard({
  blocker,
  parentTicketId,
  blockReason,
  onChanged,
}: {
  blocker: Ticket;
  /** BLOCKER 单自身视角下的父单 id（父单视角不传） */
  parentTicketId?: number;
  /** 当前轮报告的卡点说明（父单视角从 detail.report 透传；缺失不展示） */
  blockReason?: string | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState<Resolution>('continue');
  const [note, setNote] = useState('');
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [reassignWorkerId, setReassignWorkerId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  // 打开弹层时加载 Registry（改派需要）；选择非改派时清空残留
  useEffect(() => {
    if (!open) return;
    setReassignWorkerId(undefined);
    setWorkersLoading(true);
    getWorkers()
      .then(setWorkers)
      .catch(() => {
        // 错误已由 api 层统一 toast；改派场景下拉为空可选重试（重开弹层）
      })
      .finally(() => setWorkersLoading(false));
  }, [open]);

  async function handleOk() {
    const trimmed = note.trim();
    const req: ResolveBlockerRequest = { resolution };
    if (trimmed !== '') req.note = trimmed;
    if (resolution === 'reassign') {
      if (reassignWorkerId == null) return;
      req.reassignWorkerId = reassignWorkerId;
    }
    setSubmitting(true);
    try {
      await resolveBlocker(blocker.id, req);
      setOpen(false);
      onChanged();
    } catch {
      // 错误已由 api 层统一 toast（RESOLUTION_INVALID：非 BLOCKER/已关/父单非 BLOCKED 等）
    } finally {
      setSubmitting(false);
    }
  }

  const needWorker = resolution === 'reassign';
  const canSubmit = !needWorker || reassignWorkerId != null;

  return (
    <Card title="卡点处理" style={{ borderColor: '#ffa39e' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        {blockReason != null && (
          <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
            <Typography.Text type="secondary">卡点说明：</Typography.Text>
            {blockReason}
          </Typography.Paragraph>
        )}

        <Space wrap>
          <Typography.Text type="secondary">卡点单：</Typography.Text>
          <StatusTag status={blocker.status} />
          <Link to={`/tickets/${blocker.id}`}>
            #{blocker.id} {blocker.title}
          </Link>
          {parentTicketId != null && (
            <>
              <Typography.Text type="secondary">（阻塞父单</Typography.Text>
              <Link to={`/tickets/${parentTicketId}`}>#{parentTicketId}</Link>
              <Typography.Text type="secondary">）</Typography.Text>
            </>
          )}
        </Space>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          处理流程：先在卡点单留言结论（卡点单详情页留言区），再回到此处关单并选择裁决方式——
          裁决将同时关闭卡点单并转移父单状态。
        </Typography.Paragraph>

        <Button type="primary" danger onClick={() => setOpen(true)}>
          处理并关单（裁决）
        </Button>
      </Space>

      <Modal
        title={`卡点裁决 —— #${blocker.id} ${blocker.title}`}
        open={open}
        confirmLoading={submitting}
        okText="关单并裁决"
        cancelText="取消"
        okButtonProps={{ disabled: !canSubmit }}
        onOk={handleOk}
        onCancel={() => setOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="裁决方式" required>
            <Radio.Group
              value={resolution}
              onChange={(e) => setResolution(e.target.value as Resolution)}
            >
              <Space direction="vertical">
                {RESOLUTION_OPTIONS.map((opt) => (
                  <Radio key={opt.value} value={opt.value}>
                    {opt.label}
                    <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                      {opt.description}
                    </Typography.Text>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          {needWorker && (
            <Form.Item label="改派给" required tooltip="Registry 已注册的执行档案（workers/*.yaml）">
              <Select
                loading={workersLoading}
                value={reassignWorkerId}
                placeholder="选择新 worker"
                onChange={setReassignWorkerId}
                options={workers.map((w) => ({
                  value: w.id,
                  label: `${w.name}（${w.protocol} · ${w.capabilities.join(' / ')}）`,
                }))}
              />
            </Form.Item>
          )}
          <Form.Item label="裁决留言">
            <Input.TextArea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="结论与处置说明（可选，将记入卡点单留言）"
            />
          </Form.Item>
        </Form>
        {resolution === 'abort' && (
          <Alert type="warning" showIcon message="终止后父单进入失败终态，不可恢复。" />
        )}
        {needWorker && workers.length === 0 && !workersLoading && (
          <Alert
            type="error"
            showIcon
            message="worker 列表为空或加载失败：无法改派（可关闭弹窗重试，或改选其他裁决方式）"
          />
        )}
        <Tag style={{ marginTop: 12 }} color="red">
          提交即关闭卡点单并转移父单，操作不可撤销
        </Tag>
      </Modal>
    </Card>
  );
}
