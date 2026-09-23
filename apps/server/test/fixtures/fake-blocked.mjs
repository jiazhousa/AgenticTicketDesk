// 测试 fixture：模拟卡点——先落一笔提交（保留分支痕迹），再按 BLOCK_MODE 写 blocked/done 报告
// （BLOCK_MODE=done 供裁决「继续」后第二轮翻转行为；缺省 blocked）
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const mode = process.env.BLOCK_MODE ?? 'blocked';
writeFileSync('blocked-mark.txt', `blocked round mark ${Date.now()}\n`);
execFileSync('git', ['add', '-A']);
execFileSync('git', ['commit', '-m', 'fake: blocked round marker']);
if (mode === 'done') {
  writeFileSync(
    'atd-report.json',
    JSON.stringify({ status: 'done', summary: '阻塞解除后完成', commits: [] }, null, 2),
  );
} else {
  writeFileSync(
    'atd-report.json',
    JSON.stringify(
      {
        status: 'blocked',
        summary: '遇到外部卡点',
        commits: [],
        blockReason: '外部审批未通过：需要人工在方案 A/B 之间确认后继续',
      },
      null,
      2,
    ),
  );
}
