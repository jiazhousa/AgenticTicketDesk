import { useEffect, useState } from 'react';
import { Collapse, Typography } from 'antd';
import { BulbOutlined, LoadingOutlined } from '@ant-design/icons';

/**
 * 思考过程折叠块（reasoning.started/ended + live reasoning.delta 累积）。
 * streaming 期间自动展开+「思考中…」标记；全文到达（ended）自动收起，可手动再展开。
 * 载荷缺全文时仅保留 delta 累积文本（镜像全文主源缺省的记档接受面）。
 */
export default function ReasoningBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(streaming);

  // 流式开启时跟随展开；结束时收起一次（此后由用户自主控制）
  useEffect(() => {
    if (streaming) setOpen(true);
    else setOpen(false);
  }, [streaming]);

  const header = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {streaming ? <LoadingOutlined style={{ color: '#faad14' }} /> : <BulbOutlined style={{ color: '#faad14' }} />}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {streaming ? '思考中…' : '思考过程'}
      </Typography.Text>
    </span>
  );

  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        background: '#fafafa',
        overflow: 'hidden',
      }}
    >
      <Collapse
        ghost
        size="small"
        activeKey={open ? ['r'] : []}
        onChange={(keys) => setOpen(keys.includes('r'))}
        items={[
          {
            key: 'r',
            label: header,
            children: (
              <Typography.Paragraph
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 12,
                  color: 'rgba(0, 0, 0, 0.45)',
                  marginBottom: 0,
                }}
              >
                {text === '' ? '（无思考内容）' : text}
              </Typography.Paragraph>
            ),
          },
        ]}
      />
    </div>
  );
}
