import { useEffect, useState } from 'react';
import { Alert, Form, Input, Modal, Select, Typography } from 'antd';
import { getWorkers, reopenTicket } from '../api/tickets';
import type { Ticket, WorkerInfo } from '../api/types';

/**
 * 重新开单弹窗（终态 TASK）：留言即本轮指令，原 worktree 续跑（分支与半成品保留）。
 * - 留言必填（作为新一轮执行的最高优先指令注入 prompt）
 * - 可选换 worker（缺省沿用当前绑定；当前未绑定时必选——server 放行三件套要求有效 worker）
 */
export default function ReopenModal({
  ticket,
  open,
  onClose,
  onChanged,
}: {
  ticket: Ticket;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [form] = Form.useForm<{ message: string; workerId?: string }>();
  const [submitting, setSubmitting] = useState(false);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const noBoundWorker = ticket.workerId == null;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setWorkersLoading(true);
    getWorkers()
      .then(setWorkers)
      .catch(() => setWorkers([]))
      .finally(() => setWorkersLoading(false));
  }, [open, form]);

  async function handleOk() {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await reopenTicket(ticket.id, {
        message: values.message,
        workerId: values.workerId,
      });
      onClose();
      onChanged();
    } catch {
      // 错误已由 api 层统一 toast（RESOLUTION_INVALID：非 TASK/非终态；WORKER_REQUIRED 等）
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`重新开单 —— #${ticket.id} ${ticket.title}`}
      open={open}
      confirmLoading={submitting}
      okText="重开并执行"
      cancelText="取消"
      onOk={handleOk}
      onCancel={onClose}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary">
        重开后本单回到派发态并自动开始新一轮执行：复用原 worktree（前序轮次的文件与 git 历史保留），
        留言将作为本轮最高优先指令注入。
      </Typography.Paragraph>
      <Form form={form} layout="vertical">
        <Form.Item
          name="message"
          label="重开留言（本轮指令）"
          rules={[{ required: true, message: '重开留言不能为空（worker 依赖它知道这轮要做什么）' }]}
        >
          <Input.TextArea
            rows={4}
            placeholder="例如：验收发现 X 未覆盖，请在本轮补充并更新文档"
          />
        </Form.Item>
        <Form.Item
          name="workerId"
          label="执行 worker"
          tooltip="可选：换 worker 执行（复用原 worktree）；缺省沿用当前绑定"
          rules={noBoundWorker ? [{ required: true, message: '当前单未绑定 worker，重开必须选择' }] : []}
        >
          <Select
            allowClear={!noBoundWorker}
            loading={workersLoading}
            placeholder={noBoundWorker ? '必须选择执行 worker' : `沿用当前绑定（${ticket.workerId}）`}
            options={workers.map((w) => ({
              value: w.id,
              label: `${w.name}（${w.protocol} · ${w.capabilities.join(' / ')}）`,
            }))}
          />
        </Form.Item>
      </Form>
      {ticket.status === 'CANCELLED' && (
        <Alert type="warning" showIcon message="本单因派发失败被取消：确认派发阻塞已排除（如 worker 已注册），否则重开会再次失败。" />
      )}
    </Modal>
  );
}
