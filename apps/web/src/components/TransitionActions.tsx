import { useState } from 'react';
import { Button, Input, Modal, Space, Typography } from 'antd';
import { submitSpec, transitionTicket } from '../api/tickets';
import type { Ticket, TicketStatus } from '../api/types';
import { statusLabel } from './StatusTag';

/**
 * 状态操作区：按当前态渲染。
 * - DRAFT →「提交 spec」走 POST /api/tickets/:id/spec（独立路径，非 transition）
 * - 其余态 → 合法后继按钮走 POST /api/tickets/:id/transition（白名单与 server §2.1 一致）
 * - 终态（DONE/CANCELLED）无出边，不渲染按钮
 * 服务端 422（非法转移/门禁未过）的 message 已由 api 层统一 toast。
 */

/** 合法后继白名单（与 server TRANSITIONS 同步；DRAFT 的唯一出边走 /spec 端点） */
const NEXT_STATUSES: Record<TicketStatus, TicketStatus[]> = {
  DRAFT: [],
  SPEC_READY: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['DONE'],
  DONE: [],
  CANCELLED: [],
};

/** 后继动作文案（对齐 spec §3.2 转移语义） */
const ACTION_LABEL: Partial<Record<TicketStatus, string>> = {
  DISPATCHED: '放行派发',
  IN_PROGRESS: '开始执行',
  DONE: '完成关单',
  CANCELLED: '取消工单',
};

export default function TransitionActions({ ticket, onChanged }: { ticket: Ticket; onChanged: () => void }) {
  // 弹窗状态：null=关闭；'spec'=提交 spec；{to}=状态转移
  const [modal, setModal] = useState<null | 'spec' | { to: TicketStatus }>(null);
  const [specContent, setSpecContent] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function openSpecModal() {
    setSpecContent(ticket.specContent ?? '');
    setModal('spec');
  }

  function openTransitionModal(to: TicketStatus) {
    setNote('');
    setModal({ to });
  }

  async function handleOk() {
    setSubmitting(true);
    try {
      if (modal === 'spec') {
        await submitSpec(ticket.id, specContent.trim());
      } else if (modal) {
        const trimmed = note.trim();
        await transitionTicket(ticket.id, modal.to, trimmed === '' ? undefined : trimmed);
      }
      setModal(null);
      onChanged();
    } catch {
      // 错误已由 api 层统一 toast，这里仅吞掉避免 unhandled rejection
    } finally {
      setSubmitting(false);
    }
  }

  const nextStatuses = NEXT_STATUSES[ticket.status];
  const isTerminal = nextStatuses.length === 0 && ticket.status !== 'DRAFT';

  return (
    <Space wrap>
      {ticket.status === 'DRAFT' && (
        <Button type="primary" onClick={openSpecModal}>
          提交 spec
        </Button>
      )}
      {nextStatuses.map((to) => (
        <Button
          key={to}
          danger={to === 'CANCELLED'}
          type={to === 'CANCELLED' ? 'default' : 'primary'}
          onClick={() => openTransitionModal(to)}
        >
          {ACTION_LABEL[to] ?? to}
        </Button>
      ))}
      {isTerminal && <Typography.Text type="secondary">终态，无可用操作</Typography.Text>}

      {/* 提交 spec 弹窗：specContent 必填（server zod 非空校验） */}
      <Modal
        title={`提交 spec —— #${ticket.id} ${ticket.title}`}
        open={modal === 'spec'}
        confirmLoading={submitting}
        okText="提交并冻结"
        cancelText="取消"
        okButtonProps={{ disabled: specContent.trim() === '' }}
        onOk={handleOk}
        onCancel={() => setModal(null)}
      >
        <Typography.Paragraph type="secondary">
          提交后工单转入「规格就绪」，spec 快照冻结不可再改（后续变更走变更单，非 S1 范围）。
        </Typography.Paragraph>
        <Input.TextArea
          rows={10}
          value={specContent}
          onChange={(e) => setSpecContent(e.target.value)}
          placeholder="填写 spec 快照内容（必填）"
        />
      </Modal>

      {/* 状态转移弹窗：note 可选 */}
      {modal && modal !== 'spec' && (
        <Modal
          title={`确认转移 —— ${statusLabel(ticket.status)} → ${statusLabel(modal.to)}`}
          open
          confirmLoading={submitting}
          okText="确认转移"
          cancelText="取消"
          onOk={handleOk}
          onCancel={() => setModal(null)}
        >
          {modal.to === 'CANCELLED' && (
            <Typography.Paragraph type="warning">取消后工单进入终态，不可恢复。</Typography.Paragraph>
          )}
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="转移备注（可选，会记入时间线）"
          />
        </Modal>
      )}
    </Space>
  );
}
