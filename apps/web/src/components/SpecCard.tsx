import { useState } from 'react';
import { Button, Card, Form, Input, Modal, Typography } from 'antd';
import { updateTicket } from '../api/tickets';
import type { Ticket } from '../api/types';

/**
 * spec 快照卡：
 * - DRAFT 态可编辑（title/description/specContent 与 PATCH 同通道），「提交 spec」动作在 TransitionActions
 * - 其余态只读展示（SPEC_READY 起快照冻结，不可再改）
 */
export default function SpecCard({ ticket, onChanged }: { ticket: Ticket; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ title: string; description: string; specContent: string }>();
  const [submitting, setSubmitting] = useState(false);
  const editable = ticket.status === 'DRAFT';

  function openEditor() {
    form.setFieldsValue({
      title: ticket.title,
      description: ticket.description ?? '',
      specContent: ticket.specContent ?? '',
    });
    setOpen(true);
  }

  async function handleOk() {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await updateTicket(ticket.id, {
        title: values.title,
        description: values.description ?? '',
        specContent: values.specContent ?? '',
      });
      setOpen(false);
      onChanged();
    } catch {
      // 错误已由 api 层统一 toast
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      title="spec 快照"
      extra={
        editable ? (
          <Button size="small" onClick={openEditor}>
            编辑
          </Button>
        ) : (
          <Typography.Text type="secondary">已冻结</Typography.Text>
        )
      }
    >
      {ticket.specContent ? (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
          {ticket.specContent}
        </Typography.Paragraph>
      ) : (
        <Typography.Text type="secondary">（尚未填写 spec 内容）</Typography.Text>
      )}

      <Modal
        title={`编辑工单 —— #${ticket.id}`}
        open={open}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        onOk={handleOk}
        onCancel={() => setOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '标题不能为空' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="specContent" label="spec 快照">
            <Input.TextArea rows={8} placeholder="冻结前可编辑；提交 spec 后不可再改" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
