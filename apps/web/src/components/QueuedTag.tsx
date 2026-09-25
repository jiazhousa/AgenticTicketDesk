import { Space, Tag, Typography } from 'antd';
import type { Ticket } from '../api/types';
import { formatTime } from '../utils/format';

/** 排队原因文案与色分：闸门=同仓并发已满；文件冲突=声明文件集与占用单相交（仅 system 通道排队，user 通道 422 拒绝） */
const QUEUED_REASON_META: Record<'GATE_QUEUED' | 'FILE_CONFLICT', { label: string; color: string }> = {
  GATE_QUEUED: { label: '排队·并发闸门已满', color: 'orange' },
  FILE_CONFLICT: { label: '排队·文件集冲突', color: 'gold' },
};

/**
 * 排队徽标（工作台待处理区/列表页/详情页通用）。
 * 排队判定 = status==='SPEC_READY' && queuedReason 非空；非排队态渲染 null。
 * 排队单保持 SPEC_READY，前序执行释放后由系统自动放行（FIFO），无需人工操作；
 * showTime=false 用于紧凑场景（如列表页状态列）仅显原因徽标。
 */
export default function QueuedTag({ ticket, showTime = true }: { ticket: Ticket; showTime?: boolean }) {
  if (ticket.status !== 'SPEC_READY' || ticket.queuedReason == null) return null;
  const meta = QUEUED_REASON_META[ticket.queuedReason];
  return (
    <Space size={4}>
      <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
        {meta.label}
      </Tag>
      {showTime && ticket.queuedAt != null && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          排队于 {formatTime(ticket.queuedAt)}
        </Typography.Text>
      )}
    </Space>
  );
}
