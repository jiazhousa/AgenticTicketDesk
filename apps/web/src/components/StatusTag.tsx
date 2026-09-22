import { Tag } from 'antd';
import type { TicketStatus, TicketType } from '../api/types';

/** 六态色分（impl §4）：DRAFT 默认 / SPEC_READY 蓝 / DISPATCHED 青 / IN_PROGRESS 橙 / DONE 绿 / CANCELLED 灰 */
const STATUS_META: Record<TicketStatus, { label: string; color?: string }> = {
  DRAFT: { label: '草稿' },
  SPEC_READY: { label: '规格就绪', color: 'blue' },
  DISPATCHED: { label: '已派发', color: 'cyan' },
  IN_PROGRESS: { label: '进行中', color: 'orange' },
  DONE: { label: '已完成', color: 'green' },
  CANCELLED: { label: '已取消' },
};

/** 类型文案（S1 实际仅使用 STORY / TASK，BLOCKER/DREAM 为全集占位） */
const TYPE_LABEL: Record<TicketType, string> = {
  STORY: '故事',
  TASK: '任务',
  BLOCKER: '阻塞',
  DREAM: '构想',
};

export function statusLabel(status: TicketStatus): string {
  return STATUS_META[status].label;
}

export function typeLabel(type: TicketType): string {
  return TYPE_LABEL[type];
}

/** 状态标签：CANCELLED 用灰色 + 删除线与 DRAFT 默认态区分 */
export default function StatusTag({ status }: { status: TicketStatus }) {
  const meta = STATUS_META[status];
  if (status === 'CANCELLED') {
    return (
      <Tag style={{ color: '#8c8c8c', background: '#fafafa', borderColor: '#d9d9d9', textDecoration: 'line-through' }}>
        {meta.label}
      </Tag>
    );
  }
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

/** 类型标签：STORY 紫 / TASK 蓝，其余灰 */
export function TypeTag({ type }: { type: TicketType }) {
  const color = type === 'STORY' ? 'purple' : type === 'TASK' ? 'blue' : 'default';
  return <Tag color={color}>{TYPE_LABEL[type]}</Tag>;
}
