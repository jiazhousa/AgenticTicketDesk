import { Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, ToolOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

/** 工具卡状态：called=运行中 / success=完成 / failed=失败（progress 保持运行中） */
export type ToolStatus = 'running' | 'success' | 'failed';

const STATUS_META: Record<ToolStatus, { icon: ReactNode; label: string; color: string }> = {
  running: { icon: <LoadingOutlined />, label: '运行中', color: '#1677ff' },
  success: { icon: <CheckCircleOutlined />, label: '完成', color: '#52c41a' },
  failed: { icon: <CloseCircleOutlined />, label: '失败', color: '#ff4d4f' },
};

/**
 * 工具动作卡片（tool.called 打开、progress 保持、success/failed 收口；
 * 孤儿结果帧——重放窗口外先见结果——直接以终态落卡）。
 */
export default function ToolCard({ tool, status }: { tool: string; status: ToolStatus }) {
  const meta = STATUS_META[status];
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        background: '#fff',
      }}
    >
      <ToolOutlined style={{ color: 'rgba(0, 0, 0, 0.45)' }} />
      <Typography.Text code style={{ fontSize: 12 }}>
        {tool}
      </Typography.Text>
      <span style={{ color: meta.color, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {meta.icon}
        {meta.label}
      </span>
    </div>
  );
}
