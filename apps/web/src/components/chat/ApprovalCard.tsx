import { Button, Space, Tag, Typography } from 'antd';
import { SafetyOutlined } from '@ant-design/icons';
import type { HumanThinkPermissionReplyRequest } from '../../api/types';

/** 审批卡状态：pending=待审（出裁决按钮）；approved=已允许（当次）；rejected=已拒绝 */
export type ApprovalState = 'pending' | 'approved' | 'rejected';

/**
 * 权限审批卡（permission.asked / permission_request 打开，permission.rejected / permission_resolved 收口）。
 * 裁决仅两档：once=当次批准 / reject=拒绝（always 不开放——saved 规则按 projectID 与用户自用共享，防静默授权扩散）。
 */
export default function ApprovalCard({
  action,
  resources,
  state,
  replying = false,
  onReply,
}: {
  action: string;
  resources: string[];
  state: ApprovalState;
  /** 裁决请求进行中（按钮 loading） */
  replying?: boolean;
  onReply?: (decision: HumanThinkPermissionReplyRequest['decision']) => void;
}) {
  return (
    <div
      style={{
        border: `1px solid ${state === 'pending' ? '#faad14' : '#f0f0f0'}`,
        borderLeft: `3px solid ${state === 'pending' ? '#faad14' : state === 'approved' ? '#52c41a' : '#ff4d4f'}`,
        borderRadius: 8,
        padding: '8px 12px',
        background: state === 'pending' ? '#fffbe6' : '#fafafa',
      }}
    >
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space wrap size={6}>
          <SafetyOutlined style={{ color: state === 'pending' ? '#faad14' : 'rgba(0,0,0,0.45)' }} />
          <Typography.Text strong style={{ fontSize: 13 }}>
            助手请求权限
          </Typography.Text>
          <Tag color="orange">{action}</Tag>
          {state === 'pending' ? (
            <Tag color="warning">待审</Tag>
          ) : state === 'approved' ? (
            <Tag color="success">已允许（当次）</Tag>
          ) : (
            <Tag color="error">已拒绝</Tag>
          )}
        </Space>
        {resources.length > 0 ? (
          <div
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 12,
              color: 'rgba(0, 0, 0, 0.65)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {resources.join('\n')}
          </div>
        ) : null}
        {state === 'pending' && onReply != null ? (
          <Space>
            <Button size="small" type="primary" loading={replying} onClick={() => onReply('once')}>
              允许一次
            </Button>
            <Button size="small" danger loading={replying} onClick={() => onReply('reject')}>
              拒绝
            </Button>
          </Space>
        ) : null}
      </Space>
    </div>
  );
}
