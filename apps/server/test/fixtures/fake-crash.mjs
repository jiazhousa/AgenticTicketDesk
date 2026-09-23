// 测试 fixture：模拟崩溃——退出码 1，不写报告
process.stdout.write('about to crash\n');
process.exit(1);
