import { Card, Empty, Tag, Timeline as AntdTimeline, Typography } from 'antd';
import type { TicketTransition } from '../api/types';
import { statusLabel } from './StatusTag';
import { formatTime } from '../utils/format';

/**
 * 转移历史时间线：from→to + note + 时间。
 * 数据源 ticket_transitions（建单本身不落记录；首次转移通常是 DRAFT→SPEC_READY 的「提交 spec」）。
 */
export default function Timeline({ transitions }: { transitions: TicketTransition[] }) {
  if (transitions.length === 0) {
    return (
      <Card title="转移历史">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无转移记录" />
      </Card>
    );
  }

  const items = [...transitions]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((t) => ({
      children: (
        <div>
          <div>
            <Tag>{statusLabel(t.fromStatus)}</Tag>
            <Typography.Text type="secondary">→</Typography.Text>
            <Tag color={t.toStatus === 'DONE' ? 'green' : t.toStatus === 'CANCELLED' ? 'default' : 'blue'}>
              {statusLabel(t.toStatus)}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
              {formatTime(t.createdAt)} · 操作人 {t.operator}
            </Typography.Text>
          </div>
          {t.note && (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              {t.note}
            </Typography.Paragraph>
          )}
        </div>
      ),
    }));

  return (
    <Card title={`转移历史（${transitions.length}）`}>
      <AntdTimeline items={items} />
    </Card>
  );
}
