import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import SafeList from './pages/SafeList';
import SafeDetail from './pages/SafeDetail';
import Alerts from './pages/Alerts';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/safes" element={<SafeList />} />
        <Route path="/safes/:address" element={<SafeDetail />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
