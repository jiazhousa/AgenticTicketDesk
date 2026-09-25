import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import WorkbenchPage from './pages/WorkbenchPage';
import DashboardPage from './pages/DashboardPage';
import TicketListPage from './pages/TicketListPage';
import TicketDetailPage from './pages/TicketDetailPage';
import TicketLogsPage from './pages/TicketLogsPage';
import HumanThinkPage from './pages/HumanThinkPage';

/**
 * 信息架构（验收反馈口径）：
 * - /workbench 工作台（默认首页）= 人需要关注的内容：新建单、阻塞待裁决、待处理
 * - /dashboard 仪表盘 = 全局运行视图：进行中单、执行中 worker（点开进日志页）
 * - /tickets 全量列表（兜底表格视图）；/tickets/:id 详情；/tickets/:id/logs 执行日志（类 CI job 视图）
 * - /humanthink 聊天（S2b1）= 提单前的需求讨论容器：worker × workspace 长会话（流式/审批/中断）
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/workbench" replace />} />
      <Route element={<AppLayout />}>
        <Route path="/workbench" element={<WorkbenchPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/tickets" element={<TicketListPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
        <Route path="/tickets/:id/logs" element={<TicketLogsPage />} />
        <Route path="/humanthink" element={<HumanThinkPage />} />
      </Route>
    </Routes>
  );
}
