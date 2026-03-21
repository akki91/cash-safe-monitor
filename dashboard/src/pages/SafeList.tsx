import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchSafes, useWebSocket, type Safe } from '../api';
import SafeTable from '../components/SafeTable';

type FilterPreset = 'all' | 'at_risk' | 'critical';

const FILTER_PRESETS: { key: FilterPreset; label: string; minHealth?: number; maxHealth?: number }[] = [
  { key: 'all', label: 'All' },
  { key: 'at_risk', label: 'At Risk (< 1.5)', minHealth: 0, maxHealth: 1.5 },
  { key: 'critical', label: 'Critical (< 1.2)', minHealth: 0, maxHealth: 1.2 },
];

const PAGE_LIMIT = 50;

export default function SafeList() {
  const navigate = useNavigate();

  const [safes, setSafes] = useState<Safe[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState('health_factor');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState<FilterPreset>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { lastUpdateTime } = useWebSocket();
  const isInitialLoad = useRef(true);

  const activePreset = FILTER_PRESETS.find((p) => p.key === filter)!;

  const loadSafes = useCallback(async (showSpinner: boolean) => {
    try {
      if (showSpinner) setLoading(true);
      setError(null);
      const data = await fetchSafes({
        page,
        limit: PAGE_LIMIT,
        sort: sortField,
        order: sortOrder,
        minHealth: activePreset.minHealth,
        maxHealth: activePreset.maxHealth,
      });
      setSafes(data.safes);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load safes');
    } finally {
      setLoading(false);
    }
  }, [page, sortField, sortOrder, activePreset.minHealth, activePreset.maxHealth]);

  useEffect(() => {
    loadSafes(isInitialLoad.current);
    isInitialLoad.current = false;
  }, [loadSafes, lastUpdateTime]);

  const handleSort = (field: string) => {
    if (field === sortField) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const handleFilterChange = (preset: FilterPreset) => {
    setFilter(preset);
    setPage(1);
  };

  const handleRowClick = (address: string) => {
    navigate(`/safes/${address}`);
  };

  // Client-side search filtering (address)
  const filteredSafes = search.trim()
    ? safes.filter((s) => s.address.toLowerCase().includes(search.toLowerCase()))
    : safes;

  const totalPages = Math.ceil(total / PAGE_LIMIT);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Safes</h1>
          <p className="text-gray-500 mt-1">
            {total.toLocaleString()} total safe{total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search by address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
          />
        </div>

        {/* Filter Presets */}
        <div className="flex gap-2">
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => handleFilterChange(preset.key)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                filter === preset.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <div className="py-12 text-center">
            <p className="text-red-400 mb-2">{error}</p>
            <button onClick={() => loadSafes(true)} className="btn-primary text-sm">
              Retry
            </button>
          </div>
        ) : (
          <SafeTable
            safes={filteredSafes}
            onRowClick={handleRowClick}
            sortField={sortField}
            sortOrder={sortOrder}
            onSort={handleSort}
          />
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

function TableSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-10 bg-gray-800 border-b border-gray-700" />
      {[...Array(8)].map((_, i) => (
        <div key={i} className="h-14 border-b border-gray-800 flex items-center px-4 gap-4">
          <div className="h-4 w-32 bg-gray-800 rounded" />
          <div className="h-4 w-24 bg-gray-800 rounded" />
          <div className="h-4 w-24 bg-gray-800 rounded" />
          <div className="h-4 w-16 bg-gray-800 rounded" />
          <div className="h-4 w-16 bg-gray-800 rounded" />
          <div className="h-4 w-20 bg-gray-800 rounded" />
        </div>
      ))}
    </div>
  );
}
