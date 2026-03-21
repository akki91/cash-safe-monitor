import { useState, useEffect, useRef } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  fetchOverview,
  fetchActiveAlerts,
  useWebSocket,
  formatUsd,
  formatHealthFactor,
  truncateAddress,
  type OverviewData,
  type Alert,
} from '../api';

const DISTRIBUTION_COLORS: Record<string, string> = {
  healthy: '#34D399',
  info: '#FBBF24',
  warning: '#F97316',
  critical: '#EF4444',
  liquidatable: '#991B1B',
  noDebt: '#6B7280',
};

const DISTRIBUTION_LABELS: Record<string, string> = {
  healthy: 'Healthy (>2.0)',
  info: 'Info (1.5-2.0)',
  warning: 'Warning (1.2-1.5)',
  critical: 'Critical (<1.2)',
  liquidatable: 'Liquidatable (<=1.0)',
  noDebt: 'No Debt',
};

export default function Overview() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { lastUpdateTime } = useWebSocket();
  const isInitialLoad = useRef(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (isInitialLoad.current) {
          setLoading(true);
        }
        setError(null);
        const [overviewData, alertsData] = await Promise.all([
          fetchOverview(),
          fetchActiveAlerts(),
        ]);
        if (!cancelled) {
          setOverview(overviewData);
          setAlerts(alertsData.alerts);
          isInitialLoad.current = false;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load overview data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [lastUpdateTime]);

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-200 mb-2">Failed to Load</h2>
        <p className="text-gray-500 mb-4 max-w-md">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary">
          Retry
        </button>
      </div>
    );
  }

  if (!overview) return null;

  const distributionData = Object.entries(overview.distribution)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({
      name: DISTRIBUTION_LABELS[key] || key,
      count: value,
      key,
    }));

  const statCards = [
    { label: 'Total Safes', value: overview.totalSafes.toLocaleString(), icon: ShieldIcon },
    { label: 'Total Collateral', value: formatUsd(overview.totalCollateralUsd), icon: CoinIcon },
    { label: 'Total Debt', value: formatUsd(overview.totalDebtUsd), icon: DebtIcon },
    {
      label: 'Safes at Risk',
      value: overview.safesAtRisk.toLocaleString(),
      icon: AlertIcon,
      alert: overview.safesAtRisk > 0,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-gray-500 mt-1">
          System health at a glance &mdash; Average HF:{' '}
          <span className="text-gray-300 font-semibold">{overview.avgHealthFactor.toFixed(2)}</span>
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className={`card flex items-start gap-4 ${
              card.alert ? 'border-red-500/40 bg-red-500/5' : ''
            }`}
          >
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                card.alert ? 'bg-red-500/20' : 'bg-gray-700'
              }`}
            >
              <card.icon
                className={`w-5 h-5 ${card.alert ? 'text-red-400' : 'text-gray-400'}`}
              />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                {card.label}
              </p>
              <p
                className={`text-xl font-bold mt-1 tabular-nums ${
                  card.alert ? 'text-red-400' : 'text-white'
                }`}
              >
                {card.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Distribution Chart */}
        <div className="lg:col-span-2 card">
          <h2 className="text-lg font-semibold text-white mb-4">Health Factor Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={distributionData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="name"
                tick={{ fill: '#9CA3AF', fontSize: 11 }}
                tickLine={{ stroke: '#4B5563' }}
                axisLine={{ stroke: '#4B5563' }}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={60}
              />
              <YAxis
                tick={{ fill: '#9CA3AF', fontSize: 11 }}
                tickLine={{ stroke: '#4B5563' }}
                axisLine={{ stroke: '#4B5563' }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
                labelStyle={{ color: '#D1D5DB' }}
                cursor={{ fill: 'rgba(107, 114, 128, 0.15)' }}
              />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {distributionData.map((entry) => (
                  <Cell key={entry.key} fill={DISTRIBUTION_COLORS[entry.key] || '#6B7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Active Alerts */}
        <div className="card flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Active Alerts</h2>
            <span className="badge bg-red-500/20 text-red-400 border border-red-500/30">
              {alerts.length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 max-h-72">
            {alerts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No active alerts</p>
                <p className="text-xs mt-1">All safes are within safe thresholds</p>
              </div>
            ) : (
              alerts.slice(0, 10).map((alert) => (
                <div
                  key={alert.id}
                  className={`p-3 rounded-lg border ${
                    alert.severity === 'CRITICAL'
                      ? 'bg-red-500/10 border-red-500/30'
                      : alert.severity === 'WARNING'
                      ? 'bg-orange-500/10 border-orange-500/30'
                      : 'bg-yellow-500/10 border-yellow-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-xs font-bold ${
                        alert.severity === 'CRITICAL'
                          ? 'text-red-400'
                          : alert.severity === 'WARNING'
                          ? 'text-orange-400'
                          : 'text-yellow-400'
                      }`}
                    >
                      {alert.severity}
                    </span>
                    <span className="text-xs text-gray-500">
                      HF {formatHealthFactor(alert.health_factor)}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-gray-400">
                    {truncateAddress(alert.safe_address)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{alert.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading Skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-8 w-40 bg-gray-800 rounded" />
        <div className="h-4 w-64 bg-gray-800 rounded mt-2" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card h-80" />
        <div className="card h-80" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG Icons
// ---------------------------------------------------------------------------

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function CoinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function DebtIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}
