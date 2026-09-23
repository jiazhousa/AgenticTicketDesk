import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Typography } from 'antd';
import { getWorkers, transitionTicket } from '../api/tickets';
import type { Ticket, WorkerInfo } from '../api/types';

/**
 * 放行弹层（SPEC_READY 且 TASK）：选 worker → transition(to=DISPATCHED, workerId)。
 * workerId 必填（server 422 WORKER_REQUIRED）；不在 Registry 的 id 由 server 拒（WORKER_UNKNOWN）。
 * worktree 不可建等前置失败（WORKTREE_SETUP）由 server 校验，message 经 api 层 toast 原样透出。
 * STORY 放行走 TransitionActions 普通 note 弹窗（纯编排不绑 worker），不进本组件。
 */
export default function DispatchForm({
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
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [workersFailed, setWorkersFailed] = useState(false);
  const [workerId, setWorkerId] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadWorkers = useCallback(async () => {
    setWorkersLoading(true);
    setWorkersFailed(false);
    try {
      setWorkers(await getWorkers());
    } catch {
      // 错误已由 api 层统一 toast
      setWorkersFailed(true);
    } finally {
      setWorkersLoading(false);
    }
  }, []);

  // 每次打开重置选择并刷新 Registry 快照（profile 可能随部署变化）
  useEffect(() => {
    if (open) {
      setWorkerId(undefined);
      setNote('');
      void loadWorkers();
    }
  }, [open, loadWorkers]);

  async function handleOk() {
    if (workerId == null) return;
    setSubmitting(true);
    try {
      const trimmed = note.trim();
      await transitionTicket(ticket.id, 'DISPATCHED', trimmed === '' ? undefined : trimmed, workerId);
      onClose();
      onChanged();
    } catch {
      // 错误已由 api 层统一 toast（WORKER_REQUIRED/WORKER_UNKNOWN/WORKTREE_SETUP/MANUAL_FORBIDDEN 等）
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={`放行派发 —— #${ticket.id} ${ticket.title}`}
      open={open}
      confirmLoading={submitting}
      okText="放行"
      cancelText="取消"
      okButtonProps={{ disabled: workerId == null }}
      onOk={handleOk}
      onCancel={onClose}
    >
      <Typography.Paragraph type="secondary">
        放行后系统将在独立 worktree 中执行本任务：前置校验通过即派发给所选 worker，
        状态自动流转（进行中 → 已完成 / 已阻塞 / 失败），无需人工推进。
      </Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label="worker" required tooltip="Registry 已注册的执行档案（workers/*.yaml）">
          <Select
            loading={workersLoading}
            value={workerId}
            placeholder={workersFailed ? '加载失败，请重试' : '选择执行 worker'}
            status={workersFailed ? 'error' : undefined}
            onChange={(v) => setWorkerId(v)}
            notFoundContent={
              workersLoading ? '加载中…' : <Typography.Text type="secondary">无可用 worker（workers/ 目录未注册 profile）</Typography.Text>
            }
            options={workers.map((w) => ({
              value: w.id,
              label: `${w.name}（${w.protocol} · ${w.capabilities.join(' / ')}）`,
            }))}
          />
        </Form.Item>
        <Form.Item label="备注">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="放行备注（可选，会记入时间线）"
          />
        </Form.Item>
      </Form>
      {workersFailed && (
        <Alert
          type="error"
          showIcon
          message="worker 列表加载失败"
          action={
            <Button size="small" onClick={() => void loadWorkers()}>
              重试
            </Button>
          }
        />
      )}
    </Modal>
  );
}
