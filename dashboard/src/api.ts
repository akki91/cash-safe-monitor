import { useEffect, useRef, useState, useCallback } from 'react';

const BASE_URL = '/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OverviewData {
  totalSafes: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  safesAtRisk: number;
  avgHealthFactor: number;
  safesLiquidatable: number;
  activeAlerts: number;
  distribution: {
    healthy: number;
    info: number;
    warning: number;
    critical: number;
    liquidatable: number;
    noDebt: number;
  };
}

export interface Safe {
  address: string;
  total_collateral_usd: number;
  total_debt_usd: number;
  max_borrow_usd: number;
  health_factor: number;
  mode: string;
  status: string;
  is_liquidatable: boolean;
  last_polled_at?: string;
  collateral_types?: CollateralItem[];
  debt_types?: DebtItem[];
  extra_data?: ExtraData | null;
}

export interface CollateralItem {
  token: string;
  symbol: string;
  amount: string;
  price_usd: number | null;
}

export interface DebtItem {
  token: string;
  symbol: string;
  amount: string;
  price_usd: number | null;
}

export interface TokenPrice {
  token: string;
  symbol: string;
  priceUsd: number;
}

export interface ExtraData {
  tokenPrices: TokenPrice[];
  spendingLimitUsd: number;
  creditMaxSpendUsd: number;
  cashbackEarnedUsd: number;
  debitMaxSpend: {
    totalSpendableUsd: number;
    tokens: { token: string; symbol: string; amount: string; valueUsd: number }[];
  };
  withdrawalRequest: {
    tokens: { token: string; symbol: string; amount: string }[];
    requestedAt: number;
    finalizesAt: number;
  } | null;
}

export interface SafeListResponse {
  safes: Safe[];
  total: number;
  page: number;
  limit: number;
}

export interface HealthSnapshot {
  health_factor: number;
  total_collateral_usd: number;
  total_debt_usd: number;
  created_at: string;
}

export interface HistoryResponse {
  snapshots: HealthSnapshot[];
}

export interface Alert {
  id: string;
  safe_address: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  health_factor: number;
  message: string;
  created_at: string;
  resolved_at?: string;
}

export interface AlertListResponse {
  alerts: Alert[];
  total: number;
}

export interface ActiveAlertsResponse {
  alerts: Alert[];
}

// ---------------------------------------------------------------------------
// Fetch wrapper
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/** Convert DB health factor (999999 = no debt) back to Infinity. */
function dbHealthToNumber(val: unknown): number {
  if (val == null) return Infinity;
  const n = Number(val);
  return n >= 999999 ? Infinity : n;
}

/** Map a backend safe row (camelCase) to the FE Safe interface (snake_case). */
function mapSafe(raw: Record<string, unknown>): Safe {
  return {
    address: raw.address as string,
    total_collateral_usd: Number(raw.totalCollateralUsd ?? raw.total_collateral_usd ?? 0),
    total_debt_usd: Number(raw.totalDebtUsd ?? raw.total_debt_usd ?? 0),
    max_borrow_usd: Number(raw.maxBorrowUsd ?? raw.max_borrow_usd ?? 0),
    health_factor: dbHealthToNumber(raw.currentHealth ?? raw.health_factor),
    mode: (raw.mode as string) ?? '',
    status: (raw.hasDebt as boolean) ? 'active' : 'idle',
    is_liquidatable: (raw.isLiquidatable as boolean) ?? false,
    last_polled_at: (raw.lastPolledAt ?? raw.last_polled_at) as string | undefined,
  };
}

/** Map a backend snapshot row to the FE HealthSnapshot interface. */
function mapSnapshot(raw: Record<string, unknown>): HealthSnapshot {
  return {
    health_factor: dbHealthToNumber(raw.healthFactor ?? raw.health_factor),
    total_collateral_usd: Number(raw.totalCollateralUsd ?? raw.total_collateral_usd ?? 0),
    total_debt_usd: Number(raw.totalDebtUsd ?? raw.total_debt_usd ?? 0),
    created_at: (raw.createdAt ?? raw.created_at) as string,
  };
}

/** Map a backend alert row to the FE Alert interface. */
function mapAlert(raw: Record<string, unknown>): Alert {
  return {
    id: String(raw.id),
    safe_address: (raw.safeAddress ?? raw.safe_address) as string,
    severity: (raw.severity as Alert['severity']),
    health_factor: raw.healthFactor != null ? Number(raw.healthFactor) : (raw.health_factor != null ? Number(raw.health_factor) : 0),
    message: (raw.message as string) ?? '',
    created_at: (raw.createdAt ?? raw.created_at) as string,
    resolved_at: (raw.resolvedAt ?? raw.resolved_at) as string | undefined,
  };
}

export async function fetchOverview(): Promise<OverviewData> {
  const res = await apiFetch<{ data: Record<string, unknown> }>('/overview');
  const d = res.data;
  return {
    totalSafes: Number(d.totalSafes ?? 0),
    totalCollateralUsd: Number(d.totalCollateralUsd ?? 0),
    totalDebtUsd: Number(d.totalDebtUsd ?? 0),
    safesAtRisk: Number(d.safesAtRisk ?? 0),
    avgHealthFactor: Number(d.averageHealthFactor ?? 0),
    safesLiquidatable: Number(d.safesLiquidatable ?? 0),
    activeAlerts: Number(d.activeAlerts ?? 0),
    distribution: {
      healthy: Number((d.healthDistribution as Record<string, number>)?.['>2.0'] ?? 0),
      info: Number((d.healthDistribution as Record<string, number>)?.['1.5-2.0'] ?? 0),
      warning: Number((d.healthDistribution as Record<string, number>)?.['1.2-1.5'] ?? 0),
      critical: Number((d.healthDistribution as Record<string, number>)?.['1.0-1.2'] ?? 0),
      liquidatable: Number((d.healthDistribution as Record<string, number>)?.['<=1.0'] ?? 0),
      noDebt: Number((d.healthDistribution as Record<string, number>)?.['no-debt'] ?? 0),
    },
  };
}

export async function fetchSafes(params: {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  minHealth?: number;
  maxHealth?: number;
  search?: string;
}): Promise<SafeListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.sort) searchParams.set('sort', params.sort);
  if (params.order) searchParams.set('order', params.order);
  if (params.minHealth !== undefined) searchParams.set('minHealth', String(params.minHealth));
  if (params.maxHealth !== undefined) searchParams.set('maxHealth', String(params.maxHealth));
  if (params.search) searchParams.set('search', params.search);

  const res = await apiFetch<{ data: Record<string, unknown>[]; pagination: { total: number; page: number; limit: number } }>(
    `/safes?${searchParams.toString()}`,
  );

  return {
    safes: res.data.map(mapSafe),
    total: res.pagination.total,
    page: res.pagination.page,
    limit: res.pagination.limit,
  };
}

export async function fetchSafe(address: string): Promise<Safe> {
  const res = await apiFetch<{ data: Record<string, unknown> }>(`/safes/${address}`);
  const raw = res.data;
  const safe = mapSafe(raw);

  // latestSnapshot may contain collateral/debt details + extra data
  const snap = raw.latestSnapshot as Record<string, unknown> | null;
  if (snap) {
    safe.total_collateral_usd = Number(snap.totalCollateralUsd ?? safe.total_collateral_usd);
    safe.total_debt_usd = Number(snap.totalDebtUsd ?? safe.total_debt_usd);
    safe.max_borrow_usd = Number(snap.maxBorrowUsd ?? safe.max_borrow_usd);
    safe.health_factor = dbHealthToNumber(snap.healthFactor);
    safe.is_liquidatable = (snap.isLiquidatable as boolean) ?? safe.is_liquidatable;

    const collateralDetails = snap.collateralDetails as Array<Record<string, unknown>> | null;
    if (collateralDetails) {
      safe.collateral_types = collateralDetails.map((c) => ({
        token: c.token as string,
        symbol: (c.symbol as string) ?? (c.token as string).slice(0, 8),
        amount: String(c.balance ?? c.amount ?? '0'),
        price_usd: c.priceUsd != null ? Number(c.priceUsd) : null,
      }));
    }

    const debtDetails = snap.debtDetails as Array<Record<string, unknown>> | null;
    if (debtDetails) {
      safe.debt_types = debtDetails.map((d) => ({
        token: d.token as string,
        symbol: (d.symbol as string) ?? (d.token as string).slice(0, 8),
        amount: String(d.amount ?? '0'),
        price_usd: d.priceUsd != null ? Number(d.priceUsd) : null,
      }));
    }

    const extra = snap.extraData as Record<string, unknown> | null;
    if (extra) {
      safe.extra_data = {
        tokenPrices: ((extra.tokenPrices as Array<Record<string, unknown>>) ?? []).map((tp) => ({
          token: tp.token as string,
          symbol: (tp.symbol as string) ?? '',
          priceUsd: Number(tp.priceUsd ?? 0),
        })),
        spendingLimitUsd: Number(extra.spendingLimitUsd ?? 0),
        creditMaxSpendUsd: Number(extra.creditMaxSpendUsd ?? 0),
        cashbackEarnedUsd: Number(extra.cashbackEarnedUsd ?? 0),
        debitMaxSpend: (() => {
          const dms = extra.debitMaxSpend as Record<string, unknown> | null;
          if (!dms) return { totalSpendableUsd: 0, tokens: [] };
          return {
            totalSpendableUsd: Number(dms.totalSpendableUsd ?? 0),
            tokens: ((dms.tokens as Array<Record<string, unknown>>) ?? []).map((t) => ({
              token: t.token as string,
              symbol: (t.symbol as string) ?? '',
              amount: String(t.amount ?? '0'),
              valueUsd: Number(t.valueUsd ?? 0),
            })),
          };
        })(),
        withdrawalRequest: (() => {
          const wr = extra.withdrawalRequest as Record<string, unknown> | null;
          if (!wr) return null;
          return {
            tokens: ((wr.tokens as Array<Record<string, unknown>>) ?? []).map((t) => ({
              token: t.token as string,
              symbol: (t.symbol as string) ?? '',
              amount: String(t.amount ?? '0'),
            })),
            requestedAt: Number(wr.requestedAt ?? 0),
            finalizesAt: Number(wr.finalizesAt ?? 0),
          };
        })(),
      };
    }
  }

  return safe;
}

export async function fetchSafeHistory(address: string, days = 7): Promise<HistoryResponse> {
  const res = await apiFetch<{ data: Record<string, unknown>[] }>(`/safes/${address}/history?days=${days}`);
  return {
    snapshots: res.data.map(mapSnapshot),
  };
}

export async function fetchAlerts(params: {
  page?: number;
  limit?: number;
  severity?: string;
}): Promise<AlertListResponse> {
  const searchParams = new URLSearchParams();
  if (params.page !== undefined) searchParams.set('page', String(params.page));
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.severity) searchParams.set('severity', params.severity);

  const res = await apiFetch<{ data: Record<string, unknown>[]; pagination: { total: number } }>(
    `/alerts?${searchParams.toString()}`,
  );

  return {
    alerts: res.data.map(mapAlert),
    total: res.pagination.total,
  };
}

export async function fetchActiveAlerts(): Promise<ActiveAlertsResponse> {
  const res = await apiFetch<{ data: Record<string, unknown>[] }>('/alerts/active');
  return {
    alerts: res.data.map(mapAlert),
  };
}

// ---------------------------------------------------------------------------
// WebSocket Hook
// ---------------------------------------------------------------------------

export interface WsHealthUpdate {
  safeAddress: string;
  healthFactor: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  isLiquidatable: boolean;
  timestamp: string;
}

export function useWebSocket(url = 'ws://localhost:3000/ws/health') {
  const wsRef = useRef<WebSocket | null>(null);
  const [lastMessage, setLastMessage] = useState<WsHealthUpdate | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as { type: string; data?: WsHealthUpdate };
          if (msg.type === 'health-update' && msg.data) {
            setLastMessage(msg.data);
            setLastUpdateTime(Date.now());
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Attempt reconnection after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Connection failed, will retry via onclose
    }
  }, [url]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { lastMessage, isConnected, lastUpdateTime };
}

// ---------------------------------------------------------------------------
// Utility Helpers
// ---------------------------------------------------------------------------

export function formatHealthFactor(hf: number, decimals = 2): string {
  if (!isFinite(hf)) return 'N/A';
  return hf.toFixed(decimals);
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export type HealthSeverity = 'healthy' | 'info' | 'warning' | 'critical' | 'liquidatable' | 'no-debt';

export function getHealthSeverity(hf: number): HealthSeverity {
  if (!isFinite(hf)) return 'no-debt';
  if (hf <= 1.0) return 'liquidatable';
  if (hf < 1.2) return 'critical';
  if (hf < 1.5) return 'warning';
  if (hf < 2.0) return 'info';
  return 'healthy';
}

export function getHealthColor(hf: number): string {
  const severity = getHealthSeverity(hf);
  switch (severity) {
    case 'no-debt':
      return 'text-gray-400';
    case 'healthy':
      return 'text-emerald-400';
    case 'info':
      return 'text-yellow-400';
    case 'warning':
      return 'text-orange-400';
    case 'critical':
      return 'text-red-400';
    case 'liquidatable':
      return 'text-red-600';
  }
}

export function getHealthBgColor(hf: number): string {
  const severity = getHealthSeverity(hf);
  switch (severity) {
    case 'no-debt':
      return 'bg-gray-700/30 text-gray-400 border-gray-600/40';
    case 'healthy':
      return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'info':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'warning':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'critical':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'liquidatable':
      return 'bg-red-700/30 text-red-500 border-red-600/40';
  }
}
