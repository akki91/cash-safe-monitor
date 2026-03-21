import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  fetchSafe,
  fetchSafeHistory,
  useWebSocket,
  formatUsd,
  formatHealthFactor,
  truncateAddress,
  getHealthColor,
  getHealthBgColor,
  type Safe,
  type HealthSnapshot,
} from '../api';
import HealthGauge from '../components/HealthGauge';
import HealthChart from '../components/HealthChart';

export default function SafeDetail() {
  const { address } = useParams<{ address: string }>();
  const [safe, setSafe] = useState<Safe | null>(null);
  const [snapshots, setSnapshots] = useState<HealthSnapshot[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { lastUpdateTime } = useWebSocket();
  const isInitialLoad = useRef(true);

  useEffect(() => {
    if (!address) return;

    let cancelled = false;

    async function load() {
      try {
        if (isInitialLoad.current) {
          setLoading(true);
        }
        setError(null);
        const [safeData, historyData] = await Promise.all([
          fetchSafe(address!),
          fetchSafeHistory(address!, days),
        ]);
        if (!cancelled) {
          setSafe(safeData);
          setSnapshots(historyData.snapshots);
          isInitialLoad.current = false;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load safe details');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [address, days, lastUpdateTime]);

  if (loading) {
    return <DetailSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-200 mb-2">Failed to Load Safe</h2>
        <p className="text-gray-500 mb-4 max-w-md">{error}</p>
        <Link to="/safes" className="btn-primary">
          Back to Safes
        </Link>
      </div>
    );
  }

  if (!safe) return null;

  const chartData = snapshots.map((s) => ({
    healthFactor: s.health_factor,
    timestamp: s.created_at,
  }));

  const extra = safe.extra_data;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/safes" className="hover:text-gray-300 transition-colors">
          Safes
        </Link>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-300 font-mono">{truncateAddress(address!)}</span>
      </nav>

      {/* Header with Health Gauge */}
      <div className="card">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          {/* Address and mode */}
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white font-mono break-all">{address}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {safe.mode && (
                <span className="badge bg-gray-700 text-gray-300 border border-gray-600 capitalize">
                  {safe.mode}
                </span>
              )}
              <span className={`badge border ${
                safe.status === 'active'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-gray-700 text-gray-400 border-gray-600'
              } capitalize`}>
                {safe.status || 'unknown'}
              </span>
              {safe.is_liquidatable && (
                <span className="badge bg-red-700/30 text-red-400 border border-red-600/40 animate-pulse">
                  LIQUIDATABLE
                </span>
              )}
              {safe.last_polled_at && (
                <span className="text-xs text-gray-500">
                  Last polled: {new Date(safe.last_polled_at).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          {/* Health Gauge */}
          <HealthGauge healthFactor={safe.health_factor} size="lg" />
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Health Factor" value={formatHealthFactor(safe.health_factor, 4)} colorClass={getHealthColor(safe.health_factor)} />
        <StatCard label="Max Borrow" value={formatUsd(safe.max_borrow_usd)} />
        <StatCard label="LTV" value={safe.total_collateral_usd > 0
          ? `${((safe.total_debt_usd / safe.total_collateral_usd) * 100).toFixed(1)}%`
          : '0.0%'} />
        <StatCard label="Collateral / Debt" value={safe.total_debt_usd > 0
          ? `${(safe.total_collateral_usd / safe.total_debt_usd).toFixed(2)}x`
          : '--'} />
      </div>

      {/* Collateral & Debt */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Collateral */}
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Collateral</h2>
          <div className="mb-3 pb-3 border-b border-gray-700">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Value</p>
            <p className="text-2xl font-bold text-emerald-400 tabular-nums">
              {formatUsd(safe.total_collateral_usd)}
            </p>
          </div>
          {safe.collateral_types && safe.collateral_types.length > 0 ? (
            <div className="space-y-3">
              {safe.collateral_types.map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-200">{item.symbol}</p>
                    <p className="text-xs text-gray-500 font-mono">{truncateAddress(item.token)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-300 tabular-nums">{formatTokenAmount(item.amount)}</p>
                    {item.price_usd != null && (
                      <p className="text-xs text-gray-500">@ ${item.price_usd.toFixed(2)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No collateral breakdown available</p>
          )}
        </div>

        {/* Debt */}
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Debt</h2>
          <div className="mb-3 pb-3 border-b border-gray-700">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Total Debt</p>
            <p className="text-2xl font-bold text-red-400 tabular-nums">
              {formatUsd(safe.total_debt_usd)}
            </p>
          </div>
          {safe.debt_types && safe.debt_types.length > 0 ? (
            <div className="space-y-3">
              {safe.debt_types.map((item, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-200">{item.symbol}</p>
                    <p className="text-xs text-gray-500 font-mono">{truncateAddress(item.token)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-300 tabular-nums">{formatTokenAmount(item.amount)}</p>
                    {item.price_usd != null && (
                      <p className="text-xs text-gray-500">@ ${item.price_usd.toFixed(2)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No debt breakdown available</p>
          )}
        </div>
      </div>

      {/* Spending & Cashback */}
      {extra && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Spending Limits</h2>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Spending Limit</p>
                <p className="text-xl font-bold text-blue-400 tabular-nums">
                  {formatUsd(extra.spendingLimitUsd)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Credit Max Spend</p>
                <p className="text-xl font-bold text-purple-400 tabular-nums">
                  {formatUsd(extra.creditMaxSpendUsd)}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Cashback</h2>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Total Earned</p>
              <p className="text-2xl font-bold text-emerald-400 tabular-nums">
                {formatUsd(extra.cashbackEarnedUsd)}
              </p>
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold text-white mb-4">Debit Max Spend</h2>
            <div className="mb-3 pb-3 border-b border-gray-700">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Total Spendable</p>
              <p className="text-xl font-bold text-yellow-400 tabular-nums">
                {formatUsd(extra.debitMaxSpend.totalSpendableUsd)}
              </p>
            </div>
            {extra.debitMaxSpend.tokens.length > 0 ? (
              <div className="space-y-2">
                {extra.debitMaxSpend.tokens.map((t, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">{t.symbol}</span>
                    <span className="text-sm text-gray-400 tabular-nums">{formatUsd(t.valueUsd)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No spendable tokens</p>
            )}
          </div>
        </div>
      )}

      {/* Withdrawal Request */}
      {extra?.withdrawalRequest && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Pending Withdrawal</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Tokens</p>
              <div className="space-y-2">
                {extra.withdrawalRequest.tokens.map((t, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-200">{t.symbol}</span>
                    <span className="text-sm text-gray-400 tabular-nums">{formatTokenAmount(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Requested At</p>
                <p className="text-sm text-gray-300">
                  {new Date(extra.withdrawalRequest.requestedAt * 1000).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Finalizes At</p>
                <p className="text-sm text-gray-300">
                  {new Date(extra.withdrawalRequest.finalizesAt * 1000).toLocaleString()}
                </p>
                {extra.withdrawalRequest.finalizesAt * 1000 > Date.now() ? (
                  <span className="badge bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 mt-1">
                    Pending
                  </span>
                ) : (
                  <span className="badge bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 mt-1">
                    Ready
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Token Prices */}
      {extra && extra.tokenPrices.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Token Prices</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {extra.tokenPrices.map((tp, i) => (
              <div key={i} className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-200">{tp.symbol}</p>
                <p className="text-lg font-bold text-gray-100 tabular-nums">${tp.priceUsd.toFixed(2)}</p>
                <p className="text-xs text-gray-500 font-mono">{truncateAddress(tp.token)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Health Factor History Chart */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Health Factor History</h2>
          <div className="flex gap-2">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  days === d
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <HealthChart data={chartData} />
      </div>
    </div>
  );
}

/** Format large token amounts with commas and reasonable decimals. */
function formatTokenAmount(amount: string): string {
  const num = Number(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return '0';
  // For very small amounts show more decimals
  if (num < 0.01) return num.toExponential(2);
  if (num < 1) return num.toFixed(6);
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function StatCard({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="card">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${colorClass ?? 'text-gray-200'}`}>{value}</p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-4 w-48 bg-gray-800 rounded" />
      <div className="card h-36" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card h-16" />
        <div className="card h-16" />
        <div className="card h-16" />
        <div className="card h-16" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card h-48" />
        <div className="card h-48" />
      </div>
      <div className="card h-32" />
      <div className="card h-80" />
    </div>
  );
}
