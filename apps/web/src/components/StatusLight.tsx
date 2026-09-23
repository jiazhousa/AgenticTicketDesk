import type { CSSProperties } from 'react';
import type { TicketStatus } from '../api/types';
import { statusLabel } from './StatusTag';
import './StatusLight.css';

/**
 * 呼吸灯（状态灯）：列表 / 仪表盘 / Story 泳道统一使用的状态可视件。
 * 色彩与节奏约定（验收反馈口径）：
 * - IN_PROGRESS 橙色呼吸（执行中）
 * - DISPATCHED 青色轻呼吸（已派发、即将执行）
 * - DONE 绿 / BLOCKED 红 / FAILED 深红 / DRAFT 灰 / SPEC_READY 蓝 / CANCELLED 灰暗
 */

type LightMeta = { color: string; anim?: 'pulse' | 'pulse-soft' };

const STATUS_LIGHT: Record<TicketStatus, LightMeta> = {
  DRAFT: { color: '#8c8c8c' },
  SPEC_READY: { color: '#1677ff' },
  DISPATCHED: { color: '#13c2c2', anim: 'pulse-soft' },
  IN_PROGRESS: { color: '#fa8c16', anim: 'pulse' },
  BLOCKED: { color: '#ff4d4f' },
  DONE: { color: '#52c41a' },
  CANCELLED: { color: '#595959' },
  FAILED: { color: '#d4380d' },
};

export default function StatusLight({ status, size = 10 }: { status: TicketStatus; size?: number }) {
  const meta = STATUS_LIGHT[status];
  const style: CSSProperties & { '--atd-light-color': string } = {
    '--atd-light-color': meta.color,
    width: size,
    height: size,
  };
  const cls = meta.anim === 'pulse' ? 'atd-light atd-light--pulse' : meta.anim === 'pulse-soft' ? 'atd-light atd-light--pulse-soft' : 'atd-light';
  return <span className={cls} style={style} title={statusLabel(status)} aria-label={statusLabel(status)} />;
}

/** 图例项（泳道/仪表盘区头说明用）：灯 + 文案 */
export function StatusLightLegend({ items }: { items: TicketStatus[] }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      {items.map((s) => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#8c8c8c' }}>
          <StatusLight status={s} size={8} />
          {statusLabel(s)}
        </span>
      ))}
    </span>
  );
}
