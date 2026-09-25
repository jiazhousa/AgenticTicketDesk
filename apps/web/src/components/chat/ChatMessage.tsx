/**
 * 聊天消息气泡（user=右侧主色 / assistant=左侧浅底）。
 * streaming=true 为 delta 累积中的临时视图（text.ended 到达后以全文对齐收口）。
 */
export default function ChatMessage({
  role,
  text,
  streaming = false,
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}) {
  const isUser = role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '78%',
          padding: '8px 12px',
          borderRadius: 10,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: 1.7,
          fontSize: 14,
          ...(isUser
            ? { background: '#1677ff', color: '#fff', borderBottomRightRadius: 2 }
            : { background: '#f5f5f5', color: 'rgba(0, 0, 0, 0.88)', borderBottomLeftRadius: 2 }),
        }}
      >
        {/* delta 未到/纯流式开头：占位省略号；流式尾部追加光标符 */}
        {text === '' && streaming ? '…' : text}
        {streaming && text !== '' ? <span style={{ opacity: 0.6 }}>▍</span> : null}
      </div>
    </div>
  );
}
