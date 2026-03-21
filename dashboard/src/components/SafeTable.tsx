import { Safe, formatUsd, formatHealthFactor, truncateAddress, getHealthColor, getHealthBgColor, getHealthSeverity } from '../api';

interface SafeTableProps {
  safes: Safe[];
  onRowClick: (address: string) => void;
  sortField: string;
  sortOrder: 'asc' | 'desc';
  onSort: (field: string) => void;
}

const columns = [
  { key: 'address', label: 'Address' },
  { key: 'total_collateral_usd', label: 'Collateral (USD)' },
  { key: 'total_debt_usd', label: 'Debt (USD)' },
  { key: 'health_factor', label: 'Health Factor' },
  { key: 'mode', label: 'Mode' },
  { key: 'status', label: 'Status' },
];

export default function SafeTable({
  safes,
  onRowClick,
  sortField,
  sortOrder,
  onSort,
}: SafeTableProps) {
  const renderSortIcon = (field: string) => {
    if (sortField !== field) {
      return (
        <svg className="w-3 h-3 text-gray-600 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortOrder === 'asc' ? (
      <svg className="w-3 h-3 text-blue-400 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3 text-blue-400 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  const severityLabel: Record<string, string> = {
    'no-debt': 'No Debt',
    healthy: 'Healthy',
    info: 'Moderate',
    warning: 'At Risk',
    critical: 'Critical',
    liquidatable: 'Liquidatable',
  };

  if (safes.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No safes found</p>
        <p className="text-sm mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                className="text-left py-3 px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-200 transition-colors select-none"
              >
                {col.label}
                {renderSortIcon(col.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {safes.map((safe) => {
            const severity = getHealthSeverity(safe.health_factor);
            return (
              <tr
                key={safe.address}
                onClick={() => onRowClick(safe.address)}
                className="hover:bg-gray-800/60 cursor-pointer transition-colors duration-100"
              >
                <td className="py-3 px-4">
                  <span className="font-mono text-sm text-gray-300" title={safe.address}>
                    {truncateAddress(safe.address)}
                  </span>
                </td>
                <td className="py-3 px-4 text-gray-300 tabular-nums">
                  {formatUsd(safe.total_collateral_usd)}
                </td>
                <td className="py-3 px-4 text-gray-300 tabular-nums">
                  {formatUsd(safe.total_debt_usd)}
                </td>
                <td className="py-3 px-4">
                  <span className={`font-semibold tabular-nums ${getHealthColor(safe.health_factor)}`}>
                    {formatHealthFactor(safe.health_factor)}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="text-gray-400 capitalize">{safe.mode || '--'}</span>
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`badge border ${getHealthBgColor(safe.health_factor)}`}
                  >
                    {severityLabel[severity]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
