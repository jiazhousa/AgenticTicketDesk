import { Layout, Menu, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

/**
 * 全局布局：顶栏导航在「工作台 / 仪表盘 / 工单列表」三入口间切换。
 * 信息架构（验收反馈口径）：工作台=人需要关注的内容；仪表盘=全局运行视图；列表=全量兜底。
 */
const NAV_ITEMS = [
  { key: '/workbench', label: '工作台' },
  { key: '/dashboard', label: '仪表盘' },
  { key: '/tickets', label: '工单列表' },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // 详情/日志页归属工单域：路径前缀 /tickets 时高亮「工单列表」
  const selected = NAV_ITEMS.find((i) => pathname.startsWith(i.key))?.key ?? '/workbench';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <Typography.Text strong style={{ color: '#fff', fontSize: 16, whiteSpace: 'nowrap' }}>
          ATD 工单台
        </Typography.Text>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selected]}
          items={NAV_ITEMS}
          style={{ flex: 1, minWidth: 0 }}
          onClick={(e) => navigate(e.key)}
        />
      </Layout.Header>
      <Layout.Content style={{ padding: 0 }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
