import { getHealthColor, getHealthSeverity, getHealthBgColor, formatHealthFactor } from '../api';

interface HealthGaugeProps {
  healthFactor: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export default function HealthGauge({
  healthFactor,
  size = 'md',
  showLabel = true,
}: HealthGaugeProps) {
  const severity = getHealthSeverity(healthFactor);
  const colorClass = getHealthColor(healthFactor);
  const bgColorClass = getHealthBgColor(healthFactor);

  const sizeClasses = {
    sm: 'text-lg',
    md: 'text-4xl',
    lg: 'text-6xl',
  };

  const containerClasses = {
    sm: 'p-2',
    md: 'p-4',
    lg: 'p-6',
  };

  const severityLabel: Record<string, string> = {
    'no-debt': 'No Debt',
    healthy: 'Healthy',
    info: 'Moderate',
    warning: 'At Risk',
    critical: 'Critical',
    liquidatable: 'Liquidatable',
  };

  return (
    <div className={`inline-flex flex-col items-center ${containerClasses[size]}`}>
      <div
        className={`flex items-center justify-center rounded-xl border ${bgColorClass} ${
          size === 'lg' ? 'w-40 h-40' : size === 'md' ? 'w-28 h-28' : 'w-16 h-16'
        }`}
      >
        <span className={`${sizeClasses[size]} font-bold ${colorClass} tabular-nums`}>
          {formatHealthFactor(healthFactor)}
        </span>
      </div>
      {showLabel && (
        <div className="mt-2 text-center">
          <span className={`text-sm font-semibold ${colorClass}`}>
            {severityLabel[severity]}
          </span>
          <p className="text-xs text-gray-500 mt-0.5">Health Factor</p>
        </div>
      )}
    </div>
  );
}
