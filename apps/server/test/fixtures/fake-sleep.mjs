// 测试 fixture：模拟超时——常驻进程 + 孙进程（同进程组），供杀进程组断言
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// 孙进程不脱离进程组：超时 SIGTERM/SIGKILL 应连带其一起消亡
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
writeFileSync(process.env.GRANDCHILD_PID_FILE ?? '/tmp/atd-fake-sleep-grand.pid', String(grandchild.pid));
setInterval(() => {}, 1000);
