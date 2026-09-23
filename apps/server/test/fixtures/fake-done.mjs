// 测试 fixture：模拟 worker 正常完成——写文件 + git commit + 写 done 报告
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

writeFileSync('atd-artifact.txt', `artifact by fake-done at ${new Date().toISOString()}\n`);
execFileSync('git', ['add', '-A']);
execFileSync('git', ['commit', '-m', 'fake: done round']);
writeFileSync(
  'atd-report.json',
  JSON.stringify({ status: 'done', summary: '完成：写入 atd-artifact.txt 并提交', commits: [] }, null, 2),
);
