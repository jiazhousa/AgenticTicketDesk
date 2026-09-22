import { useEffect, useState } from 'react';
import { Button, Card, InputNumber, List, Popconfirm, Space, Typography, message } from 'antd';
import { DeleteOutlined, LinkOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { addDependency, getTicket, removeDependency } from '../api/tickets';
import type { Ticket } from '../api/types';
import StatusTag from './StatusTag';

/**
 * 依赖区：父单链接 / 子单列表（状态角标）/ blockedBy 列表（可增删）。
 * 依赖语义：blockedBy 单全部 DONE 后本单才允许「放行派发」（DISPATCHED 门禁在 server 校验）。
 */
export default function DependencyPanel({
  ticket,
  children,
  dependencies,
  onChanged,
}: {
  ticket: Ticket;
  children: Ticket[];
  dependencies: Ticket[];
  onChanged: () => void;
}) {
  const [parentTitle, setParentTitle] = useState<string | null>(null);
  const [blockedById, setBlockedById] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  // 详情响应不含父单对象，按 parentId 懒加载父单标题
  useEffect(() => {
    if (ticket.parentId == null) {
      setParentTitle(null);
      return;
    }
    let cancelled = false;
    getTicket(ticket.parentId)
      .then((detail) => {
        if (!cancelled) setParentTitle(detail.ticket.title);
      })
      .catch(() => {
        // 父单不存在（理论上创建时已校验）：保持仅展示单号
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.parentId]);

  async function handleAdd() {
    if (blockedById == null) return;
    if (blockedById === ticket.id) {
      // 前端预校验：自依赖必然被 server 拒（DAG_INVALID），提前提示
      message.warning('不能依赖自身');
      return;
    }
    setAdding(true);
    try {
      await addDependency(ticket.id, blockedById);
      setBlockedById(null);
      onChanged();
    } catch {
      // 错误已由 api 层统一 toast（DAG_INVALID：自依赖/成环等）
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card title="依赖与父子">
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 父单 */}
        <div>
          <Typography.Text type="secondary">父单：</Typography.Text>
          {ticket.parentId != null ? (
            <Link to={`/tickets/${ticket.parentId}`}>
              <LinkOutlined /> #{ticket.parentId} {parentTitle ?? '加载中…'}
            </Link>
          ) : (
            <Typography.Text>无（顶层工单）</Typography.Text>
          )}
        </div>

        {/* 子单列表 */}
        <div>
          <Typography.Text type="secondary">子单（{children.length}）：</Typography.Text>
          {children.length === 0 ? (
            <Typography.Text type="secondary">暂无子单</Typography.Text>
          ) : (
            <List
              size="small"
              dataSource={children}
              renderItem={(child) => (
                <List.Item style={{ padding: '4px 0' }}>
                  <Space>
                    <StatusTag status={child.status} />
                    <Link to={`/tickets/${child.id}`}>#{child.id} {child.title}</Link>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </div>

        {/* blockedBy 依赖列表 */}
        <div>
          <Typography.Text type="secondary">被阻塞于（blockedBy，{dependencies.length}）：</Typography.Text>
          {dependencies.length === 0 ? (
            <Typography.Text type="secondary">无依赖，可直接派发</Typography.Text>
          ) : (
            <List
              size="small"
              dataSource={dependencies}
              renderItem={(dep) => (
                <List.Item
                  style={{ padding: '4px 0' }}
                  actions={[
                    <Popconfirm
                      key="remove"
                      title="移除该依赖？"
                      description="移除后对应的 blockedBy 门禁解除"
                      onConfirm={async () => {
                        try {
                          await removeDependency(ticket.id, dep.id);
                          onChanged();
                        } catch {
                          // 错误已由 api 层统一 toast
                        }
                      }}
                    >
                      <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <Space>
                    <StatusTag status={dep.status} />
                    <Link to={`/tickets/${dep.id}`}>#{dep.id} {dep.title}</Link>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </div>

        {/* 添加依赖 */}
        <Space>
          <InputNumber
            min={1}
            precision={0}
            value={blockedById}
            onChange={(v) => setBlockedById(typeof v === 'number' ? v : null)}
            placeholder="依赖单号"
            style={{ width: 140 }}
          />
          <Button loading={adding} disabled={blockedById == null} onClick={handleAdd}>
            添加依赖
          </Button>
        </Space>
      </Space>
    </Card>
  );
}
