import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchAlerts, truncateAddress, formatHealthFactor, type Alert } from '../api';

const SEVERITY_OPTIONS = ['ALL', 'CRITICAL', 'WARNING', 'INFO'] as const;

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
  WARNING: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  INFO: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

const PAGE_LIMIT = 20;

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAlerts({
        page,
        limit: PAGE_LIMIT,
        severity: severity === 'ALL' ? undefined : severity,
      });
      setAlerts(data.alerts);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [page, severity]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const handleSeverityChange = (sev: string) => {
    setSeverity(sev);
    setPage(1);
  };

  const totalPages = Math.ceil(total / PAGE_LIMIT);

  function formatTimestamp(ts: string): string {
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts</h1>
          <p className="text-gray-500 mt-1">
            {total.toLocaleString()} alert{total !== 1 ? 's' : ''}
            {severity !== 'ALL' ? ` (${severity})` : ''}
          </p>
        </div>
      </div>

      {/* Severity Filter */}
      <div className="flex gap-2">
        {SEVERITY_OPTIONS.map((sev) => (
          <button
            key={sev}
            onClick={() => handleSeverityChange(sev)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
              severity === sev
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
            }`}
          >
            {sev === 'ALL' ? 'All' : sev.charAt(0) + sev.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Alert List */}
      <div className="space-y-3">
        {loading ? (
          <AlertsSkeleton />
        ) : error ? (
          <div className="card text-center py-12">
            <p className="text-red-400 mb-2">{error}</p>
            <button onClick={loadAlerts} className="btn-primary text-sm">
              Retry
            </button>
          </div>
        ) : alerts.length === 0 ? (
          <div className="card text-center py-12">
            <svg
              className="w-12 h-12 text-gray-600 mx-auto mb-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-gray-400 text-lg">No alerts found</p>
            <p className="text-gray-600 text-sm mt-1">
              {severity !== 'ALL'
                ? `No ${severity.toLowerCase()} alerts at this time`
                : 'The system is running smoothly'}
            </p>
          </div>
        ) : (
          alerts.map((alert) => (
            <div
              key={alert.id}
              className="card p-4 hover:bg-gray-750 transition-colors duration-100"
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                {/* Severity Badge */}
                <span
                  className={`badge border flex-shrink-0 ${
                    SEVERITY_STYLES[alert.severity] || 'bg-gray-700 text-gray-400 border-gray-600'
                  }`}
                >
                  {alert.severity}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <Link
                      to={`/safes/${alert.safe_address}`}
                      className="font-mono text-sm text-blue-400 hover:text-blue-300 transition-colors"
                      title={alert.safe_address}
                    >
                      {truncateAddress(alert.safe_address)}
                    </Link>
                    <span className="text-xs text-gray-500">
                      {formatTimestamp(alert.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 mt-1">{alert.message}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-xs text-gray-500">
                      Health Factor:{' '}
                      <span className="text-gray-300 font-semibold tabular-nums">
                        {formatHealthFactor(alert.health_factor)}
                      </span>
                    </span>
                    {alert.resolved_at && (
                      <span className="text-xs text-emerald-500">
                        Resolved {formatTimestamp(alert.resolved_at)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && !loading && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-secondary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertsSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="card p-4">
          <div className="flex gap-3">
            <div className="h-5 w-16 bg-gray-700 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 bg-gray-700 rounded" />
              <div className="h-3 w-full bg-gray-800 rounded" />
              <div className="h-3 w-24 bg-gray-800 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
