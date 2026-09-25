// 测试 fixture：按命令行实参（argv[4]=实例名，argv[2]/[3] 为 worktree/prompt 占位）写独立命名的
// 产物并提交 + done 报告。双并行用例以命令行参数区分两个 fake worker 实例（进程级 env 无法区分
// 同时执行的两单），产物名即断言钩子（各 worktree 内仅应存在本实例产物）。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const name = process.argv[4] ?? 'anon';
writeFileSync(`atd-artifact-${name}.txt`, `artifact by fake-done-arg ${name} at ${new Date().toISOString()}\n`);
execFileSync('git', ['add', '-A']);
execFileSync('git', ['commit', '-m', `fake: done round (${name})`]);
writeFileSync(
  'atd-report.json',
  JSON.stringify({ status: 'done', summary: `完成：写入 atd-artifact-${name}.txt 并提交`, commits: [] }, null, 2),
);
