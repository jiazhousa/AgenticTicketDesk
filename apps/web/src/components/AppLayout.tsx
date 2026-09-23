import { useEffect, useMemo } from 'react';
import { Layout, Menu, Select, Space, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { useWorkspaceMap } from '../utils/workspace';

/**
 * 全局布局：顶栏导航在「工作台 / 仪表盘 / 工单列表」三入口间切换；
 * 右侧 workspace 切换器（「全部」+ 各 workspace「显示名 · 主仓名」）——
 * 切换即更新全局态，三页列表随所选 workspace 过滤（null=全部=不传过滤参数）。
 */
const NAV_ITEMS = [
  { key: '/workbench', label: '工作台' },
  { key: '/dashboard', label: '仪表盘' },
  { key: '/tickets', label: '工单列表' },
];

/** 「全部」选项哨兵值（Select 值域为 string，Context 态以 null 表达） */
const ALL_VALUE = 'all';

export default function AppLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { workspaceId, setWorkspaceId } = useWorkspace();
  const workspaceMap = useWorkspaceMap();
  const workspaces = useMemo(
    () => (workspaceMap ? [...workspaceMap.values()] : []),
    [workspaceMap],
  );

  // 详情/日志页归属工单域：路径前缀 /tickets 时高亮「工单列表」
  const selected = NAV_ITEMS.find((i) => pathname.startsWith(i.key))?.key ?? '/workbench';

  // 所选 id 失效（yaml 删除后 localStorage 残留）→ 回退「全部」
  useEffect(() => {
    if (workspaceMap != null && workspaceId != null && !workspaceMap.has(workspaceId)) {
      setWorkspaceId(null);
    }
  }, [workspaceMap, workspaceId, setWorkspaceId]);

  const options = [
    { value: ALL_VALUE, label: '全部' },
    ...workspaces.map((w) => ({ value: w.id, label: `${w.name} · ${w.primary}` })),
  ];

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
        <Space size={8} style={{ flex: 'none' }}>
          <Typography.Text style={{ color: 'rgba(255, 255, 255, 0.65)', whiteSpace: 'nowrap' }}>
            工作空间
          </Typography.Text>
          <Select
            style={{ minWidth: 200 }}
            loading={workspaceMap == null}
            disabled={workspaceMap == null}
            value={workspaceId ?? ALL_VALUE}
            options={options}
            onChange={(v) => setWorkspaceId(v === ALL_VALUE ? null : v)}
          />
        </Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 0 }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  );
}
