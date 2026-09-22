import { Navigate, Route, Routes } from 'react-router-dom';
import TicketListPage from './pages/TicketListPage';
import TicketDetailPage from './pages/TicketDetailPage';

/** S1 最小看板两页：列表页 + 详情页 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/tickets" replace />} />
      <Route path="/tickets" element={<TicketListPage />} />
      <Route path="/tickets/:id" element={<TicketDetailPage />} />
    </Routes>
  );
}
