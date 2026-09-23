import { Card, List, Tag, Typography } from 'antd';
import type { TicketCommit, TicketReport } from '../api/types';

/**
 * 完成报告卡（DONE 态渲染）：worker 产出的 atd-report.json 摘要 + 工单级 commit 关联。
 * commits 来自 git 实测归集（各轮并集，含轮次），报告内 commits 仅交叉校验不直接展示。
 */
export default function ReportCard({ report, commits }: { report: TicketReport; commits: TicketCommit[] }) {
  return (
    <Card title="完成报告">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
        第 {report.round} 轮报告
        <Tag color={report.status === 'done' ? 'green' : 'orange'} style={{ marginLeft: 8 }}>
          {report.status === 'done' ? '完成' : '卡点'}
        </Tag>
      </Typography.Paragraph>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
        {report.summary ?? '（无摘要）'}
      </Typography.Paragraph>

      <Typography.Text type="secondary">commits（{commits.length}，git 实测归集）：</Typography.Text>
      {commits.length === 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          无 commit（纯调研类任务合法，以 summary 为准）
        </Typography.Paragraph>
      ) : (
        <List
          size="small"
          dataSource={commits}
          renderItem={(c) => (
            <List.Item style={{ padding: '4px 0' }}>
              <Typography.Text>
                <Tag>r{c.round}</Tag>
                <Typography.Text code copyable={{ text: c.sha }}>
                  {c.sha}
                </Typography.Text>
              </Typography.Text>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}
