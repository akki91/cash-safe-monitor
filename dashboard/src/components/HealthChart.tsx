import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

interface DataPoint {
  healthFactor: number;
  timestamp: string;
}

interface HealthChartProps {
  data: DataPoint[];
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function HealthChart({ data }: HealthChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        No history data available
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    label: formatDate(d.timestamp),
  }));

  const allValues = data.map((d) => d.healthFactor);
  const minHf = Math.min(...allValues);
  const maxHf = Math.max(...allValues);
  const yMin = Math.max(0, Math.floor(minHf * 10 - 2) / 10);
  const yMax = Math.ceil(maxHf * 10 + 2) / 10;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#9CA3AF', fontSize: 11 }}
          tickLine={{ stroke: '#4B5563' }}
          axisLine={{ stroke: '#4B5563' }}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[yMin, yMax]}
          tick={{ fill: '#9CA3AF', fontSize: 11 }}
          tickLine={{ stroke: '#4B5563' }}
          axisLine={{ stroke: '#4B5563' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#1F2937',
            border: '1px solid #374151',
            borderRadius: '8px',
            fontSize: '13px',
          }}
          labelStyle={{ color: '#9CA3AF' }}
          formatter={(value: number) => [value.toFixed(4), 'Health Factor']}
        />

        {/* Reference lines for severity thresholds */}
        <ReferenceLine
          y={2.0}
          stroke="#34D399"
          strokeDasharray="6 3"
          label={{ value: 'HF 2.0', fill: '#34D399', fontSize: 10, position: 'right' }}
        />
        <ReferenceLine
          y={1.5}
          stroke="#FBBF24"
          strokeDasharray="6 3"
          label={{ value: 'HF 1.5', fill: '#FBBF24', fontSize: 10, position: 'right' }}
        />
        <ReferenceLine
          y={1.2}
          stroke="#F97316"
          strokeDasharray="6 3"
          label={{ value: 'HF 1.2', fill: '#F97316', fontSize: 10, position: 'right' }}
        />
        <ReferenceLine
          y={1.0}
          stroke="#EF4444"
          strokeDasharray="6 3"
          label={{ value: 'HF 1.0', fill: '#EF4444', fontSize: 10, position: 'right' }}
        />

        {/* Health Factor line */}
        <Line
          type="monotone"
          dataKey="healthFactor"
          stroke="#3B82F6"
          strokeWidth={2}
          dot={{ r: 3, fill: '#3B82F6', strokeWidth: 0 }}
          activeDot={{ r: 5, fill: '#60A5FA', strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
