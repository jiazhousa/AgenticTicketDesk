import { useState } from 'react';
import { Button, Card, Input, List, Space, Tag, Typography } from 'antd';
import { SendOutlined, UserOutlined } from '@ant-design/icons';
import { addComment } from '../api/tickets';
import type { TicketComment } from '../api/types';
import { formatTime } from '../utils/format';

/** 作者类型标签色分：user 蓝 / agent 紫 / system 灰 */
const AUTHOR_META: Record<TicketComment['authorType'], { label: string; color: string }> = {
  user: { label: '我', color: 'blue' },
  agent: { label: 'Agent', color: 'purple' },
  system: { label: '系统', color: 'default' },
};

/**
 * 留言流：时间正序（API 返回即正序）+ 发送框。
 * S1 固定以 user 身份发言（authorType/authorName 由 server 落定）。
 */
export default function CommentStream({
  ticketId,
  comments,
  onSent,
}: {
  ticketId: number;
  comments: TicketComment[];
  onSent: () => void;
}) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const trimmed = content.trim();
    if (trimmed === '') return;
    setSending(true);
    try {
      await addComment(ticketId, trimmed);
      setContent('');
      onSent();
    } catch {
      // 错误已由 api 层统一 toast
    } finally {
      setSending(false);
    }
  }

  return (
    <Card title={`留言（${comments.length}）`}>
      <List
        size="small"
        dataSource={comments}
        locale={{ emptyText: '暂无留言' }}
        renderItem={(item) => {
          const meta = AUTHOR_META[item.authorType];
          return (
            <List.Item style={{ padding: '6px 0' }}>
              <List.Item.Meta
                avatar={<UserOutlined style={{ fontSize: 16, color: '#8c8c8c' }} />}
                title={
                  <Space>
                    <Tag color={meta.color}>{meta.label}</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.authorName} · {formatTime(item.createdAt)}
                    </Typography.Text>
                  </Space>
                }
                description={<Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{item.content}</Typography.Paragraph>}
              />
            </List.Item>
          );
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Input.TextArea
          rows={2}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="输入留言…"
          onPressEnter={(e) => {
            // Ctrl/Shift+Enter 换行，Enter 直接发送
            if (!e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button type="primary" icon={<SendOutlined />} loading={sending} disabled={content.trim() === ''} onClick={handleSend}>
          发送
        </Button>
      </div>
    </Card>
  );
}
