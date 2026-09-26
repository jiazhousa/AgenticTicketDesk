/**
 * 聊天消息气泡（user=右侧主色纯文本 / assistant=左侧浅底 markdown 渲染）。
 * streaming=true 为 delta 累积中的临时视图（text.ended 到达后以全文对齐收口）。
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** markdown 块级样式（antd 之外的最小集——表格边框/代码块底色/列表段落间距） */
const mdComponents = {
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre
      style={{
        background: '#f6f8fa',
        padding: '10px 12px',
        borderRadius: 8,
        overflowX: 'auto',
        fontSize: 13,
        margin: '8px 0',
      }}
    >
      {children}
    </pre>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = /language-/.test(className ?? '');
    return (
      <code
        className={className}
        style={
          isBlock
            ? { fontFamily: 'ui-monospace, monospace', fontSize: 13 }
            : {
                fontFamily: 'ui-monospace, monospace',
                fontSize: 13,
                background: 'rgba(0, 0, 0, 0.06)',
                padding: '1px 5px',
                borderRadius: 4,
              }
        }
      >
        {children}
      </code>
    );
  },
  p: ({ children }: { children?: React.ReactNode }) => <p style={{ margin: '0 0 8px' }}>{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li style={{ margin: '2px 0' }}>{children}</li>,
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 style={{ fontSize: 18, margin: '12px 0 8px' }}>{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 style={{ fontSize: 16, margin: '12px 0 8px' }}>{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 style={{ fontSize: 15, margin: '10px 0 6px' }}>{children}</h3>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <table
      style={{
        borderCollapse: 'collapse',
        margin: '8px 0',
        fontSize: 13,
      }}
    >
      {children}
    </table>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th style={{ border: '1px solid #e5e5e5', padding: '4px 10px', background: '#fafafa' }}>{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td style={{ border: '1px solid #e5e5e5', padding: '4px 10px' }}>{children}</td>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote style={{ margin: '8px 0', padding: '2px 12px', borderLeft: '3px solid #e5e5e5', color: 'rgba(0,0,0,0.55)' }}>
      {children}
    </blockquote>
  ),
} as const;

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
          maxWidth: '88%',
          padding: '8px 12px',
          borderRadius: 10,
          wordBreak: 'break-word',
          lineHeight: 1.7,
          fontSize: 14,
          ...(isUser
            ? {
                background: '#1677ff',
                color: '#fff',
                borderBottomRightRadius: 2,
                whiteSpace: 'pre-wrap',
              }
            : {
                background: '#f5f5f5',
                color: 'rgba(0, 0, 0, 0.88)',
                borderBottomLeftRadius: 2,
                overflowX: 'auto',
              }),
        }}
      >
        {isUser ? (
          <>
            {text === '' && streaming ? '…' : text}
            {streaming && text !== '' ? <span style={{ opacity: 0.6 }}>▍</span> : null}
          </>
        ) : (
          // assistant 输出按 markdown 渲染（ReactMarkdown 默认不透传原始 HTML——agent 输出不注入页面）
          <>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
              {text === '' && streaming ? '…' : text}
            </ReactMarkdown>
            {streaming && text !== '' ? <span style={{ opacity: 0.6 }}>▍</span> : null}
          </>
        )}
      </div>
    </div>
  );
}
