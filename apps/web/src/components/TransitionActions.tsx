import { useState } from 'react';
import { Button, Input, Modal, Space, Typography } from 'antd';
import { RedoOutlined } from '@ant-design/icons';
import { submitSpec, transitionTicket } from '../api/tickets';
import type { Ticket, TicketStatus, TicketType } from '../api/types';
import { statusLabel } from './StatusTag';
import DispatchForm from './DispatchForm';
import ReopenModal from './ReopenModal';

/**
 * 状态操作区：按当前态与工单类型渲染（转移通道二分，与 server 状态机同步）。
 * - DRAFT →「提交 spec」走 POST /api/tickets/:id/spec（独立路径，非 transition）
 * - STORY（纯编排）：S1 人工边全保留（含开始执行/完成关单，人工推进）
 * - TASK（执行单）：仅 user 白名单边——放行派发（需选 worker，走 DispatchForm）/ 取消；
 *   执行推进边（开始/完成/转阻塞/失败）由 dispatcher system 通道自动流转，user 请求 → 422 MANUAL_FORBIDDEN
 * - BLOCKER：不提供常规转移（关单走卡点裁决，见 BlockerCard）
 * - 终态 TASK：「重新开单」（留言即本轮指令，原 worktree 续跑，走 /reopen 端点）
 * - 终态（DONE/CANCELLED/FAILED）STORY 无出边，不渲染按钮
 * 服务端 422（非法转移/门禁未过/越权手推）的 message 已由 api 层统一 toast 原样透出。
 */

/** user 可达后继白名单（按 type 分流；与 server §1 通道二分一致） */
function userNextStatuses(type: TicketType, status: TicketStatus): TicketStatus[] {
  if (type === 'BLOCKER' || type === 'DREAM') {
    // BLOCKER 关单走 /resolve 裁决端点；DREAM 为占位类型
    return [];
  }
  if (type === 'TASK') {
    switch (status) {
      case 'SPEC_READY':
        return ['DISPATCHED', 'CANCELLED'];
      case 'DISPATCHED':
        return ['CANCELLED'];
      case 'BLOCKED':
        return ['CANCELLED'];
      default:
        // IN_PROGRESS 的推进/终态边均由 system 通道流转
        return [];
    }
  }
  // STORY：S1 人工边全保留
  switch (status) {
    case 'SPEC_READY':
      return ['DISPATCHED', 'CANCELLED'];
    case 'DISPATCHED':
      return ['IN_PROGRESS', 'CANCELLED'];
    case 'IN_PROGRESS':
      return ['DONE'];
    default:
      return [];
  }
}

/** 后继动作文案（对齐 spec §3.2 转移语义） */
const ACTION_LABEL: Partial<Record<TicketStatus, string>> = {
  DISPATCHED: '放行派发',
  IN_PROGRESS: '开始执行',
  DONE: '完成关单',
  CANCELLED: '取消工单',
};

export default function TransitionActions({ ticket, onChanged }: { ticket: Ticket; onChanged: () => void }) {
  // 弹窗状态：null=关闭；'spec'=提交 spec；'dispatch'=TASK 放行（DispatchForm）；'reopen'=终态重开（ReopenModal）；{to}=普通状态转移
  const [modal, setModal] = useState<null | 'spec' | 'dispatch' | 'reopen' | { to: TicketStatus }>(null);
  const [specContent, setSpecContent] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function openSpecModal() {
    setSpecContent(ticket.specContent ?? '');
    setModal('spec');
  }

  function openTransitionModal(to: TicketStatus) {
    if (ticket.type === 'TASK' && to === 'DISPATCHED') {
      // TASK 放行必须选 worker，走 DispatchForm 弹层（该按钮仅 SPEC_READY 态出现）
      setModal('dispatch');
      return;
    }
    setNote('');
    setModal({ to });
  }

  async function handleOk() {
    setSubmitting(true);
    try {
      if (modal === 'spec') {
        await submitSpec(ticket.id, specContent.trim());
      } else if (modal && modal !== 'dispatch' && modal !== 'reopen') {
        // 此处 modal 已窄化为 { to }（'spec'/'dispatch'/'reopen' 各自弹层独立处理）
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

  const nextStatuses = userNextStatuses(ticket.type, ticket.status);
  // 终态判定基于状态本身（而非按钮为空——TASK 执行中无 user 按钮但不是终态）
  const isTerminal = ticket.status === 'DONE' || ticket.status === 'CANCELLED' || ticket.status === 'FAILED';
  // user 无可用操作但状态仍在流转（TASK 执行中，由 dispatcher system 通道推进）
  const autoAdvancing =
    !isTerminal && nextStatuses.length === 0 && ticket.status !== 'DRAFT' && ticket.type === 'TASK';

  return (
    <Space wrap>
      {ticket.status === 'DRAFT' && ticket.type !== 'BLOCKER' && ticket.type !== 'DREAM' && (
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
      {isTerminal && ticket.type === 'BLOCKER' && (
        <Typography.Text type="secondary">本单为卡点单，关单通过「卡点处理」区的裁决完成</Typography.Text>
      )}
      {isTerminal && ticket.type === 'TASK' && (
        <Button icon={<RedoOutlined />} onClick={() => setModal('reopen')}>
          重新开单
        </Button>
      )}
      {isTerminal && ticket.type === 'STORY' && (
        <Typography.Text type="secondary">终态，无可用操作（如需重做请新建工单）</Typography.Text>
      )}
      {autoAdvancing && (
        <Typography.Text type="secondary">执行由 worker 自动推进（进行中 → 完成 / 阻塞 / 失败）</Typography.Text>
      )}

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
          提交后工单转入「规格就绪」，spec 快照冻结不可再改（后续变更走变更单）。
        </Typography.Paragraph>
        <Input.TextArea
          rows={10}
          value={specContent}
          onChange={(e) => setSpecContent(e.target.value)}
          placeholder="填写 spec 快照内容（必填）"
        />
      </Modal>

      {/* TASK 放行弹层：选 worker（workerId 必填），独立组件管理 Registry 加载 */}
      <DispatchForm
        ticket={ticket}
        open={modal === 'dispatch'}
        onClose={() => setModal(null)}
        onChanged={onChanged}
      />

      {/* 终态 TASK 重开弹层：留言即本轮指令 + 可选换 worker（原 worktree 续跑） */}
      <ReopenModal
        ticket={ticket}
        open={modal === 'reopen'}
        onClose={() => setModal(null)}
        onChanged={onChanged}
      />

      {/* 状态转移弹窗：note 可选 */}
      {modal && modal !== 'spec' && modal !== 'dispatch' && modal !== 'reopen' && (
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
