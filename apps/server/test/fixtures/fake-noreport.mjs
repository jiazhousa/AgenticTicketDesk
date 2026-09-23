// 测试 fixture：正常退出但不写报告（触发 L2 重试 → 重试耗尽后 L3 升级）
process.stdout.write('no report round\n');
