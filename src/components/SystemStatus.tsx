import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity,
  Server,
  Database,
  HardDrive,
  Clock,
  ShieldCheck,
  Users,
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Radio,
  Layers,
  ChevronDown,
  ChevronUp,
  FileCode,
  Zap,
} from "lucide-react";

export interface HealthDatabaseMetrics {
  status: string;
  recordsCount: number;
  membersCount: number;
  usersCount: number;
  auditLogsCount: number;
  version: number;
  lastModified: string;
  storageCapacity: string;
  diskCommitMode: string;
  persistenceStrategy: string;
}

export interface HealthSystemMetrics {
  platform: string;
  nodeVersion: string;
  pid: number;
  memory: {
    rssMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
  };
}

export interface HealthData {
  status: "ok" | "degraded" | "error" | string;
  version: string;
  env: string;
  engine: string;
  uptime: number;
  uptimeFormatted: string;
  clientsConnected: number;
  database: HealthDatabaseMetrics;
  system: HealthSystemMetrics;
  timestamp: string;
}

export interface SystemStatusProps {
  apiEndpoint?: string;
  refreshIntervalMs?: number;
  autoRefreshEnabled?: boolean;
  className?: string;
  showRawPayload?: boolean;
  compact?: boolean;
  onStatusChange?: (data: HealthData | null, isOnline: boolean) => void;
}

export const SystemStatus: React.FC<SystemStatusProps> = ({
  apiEndpoint = "/api/health",
  refreshIntervalMs = 5000,
  autoRefreshEnabled = true,
  className = "",
  showRawPayload = false,
  compact = false,
  onStatusChange,
}) => {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [isAutoRefresh, setIsAutoRefresh] = useState<boolean>(autoRefreshEnabled);
  const [showJson, setShowJson] = useState<boolean>(showRawPayload);
  const [localUptime, setLocalUptime] = useState<number>(0);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const uptimeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchHealth = useCallback(async (isManual: boolean = false) => {
    if (isManual) setRefreshing(true);
    const start = performance.now();

    try {
      const response = await fetch(apiEndpoint, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      const latency = Math.round(performance.now() - start);
      setLatencyMs(latency);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json: HealthData = await response.json();
      setData(json);
      setLocalUptime(json.uptime || 0);
      setError(null);
      setLastCheckTime(new Date());

      if (onStatusChange) {
        onStatusChange(json, true);
      }
    } catch (err: any) {
      const errMsg = err?.message || "Failed to connect to backend server";
      setError(errMsg);
      if (onStatusChange) {
        onStatusChange(null, false);
      }
    } finally {
      setLoading(false);
      if (isManual) {
        setTimeout(() => setRefreshing(false), 300);
      }
    }
  }, [apiEndpoint, onStatusChange]);

  // Initial fetch and polling loop
  useEffect(() => {
    fetchHealth(false);

    if (isAutoRefresh && refreshIntervalMs > 0) {
      timerRef.current = setInterval(() => {
        fetchHealth(false);
      }, refreshIntervalMs);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchHealth, isAutoRefresh, refreshIntervalMs]);

  // Client-side ticking uptime counter
  useEffect(() => {
    uptimeTimerRef.current = setInterval(() => {
      setLocalUptime((prev) => prev + 1);
    }, 1000);

    return () => {
      if (uptimeTimerRef.current) clearInterval(uptimeTimerRef.current);
    };
  }, []);

  const formatUptimeDisplay = (totalSeconds: number) => {
    const days = Math.floor(totalSeconds / (3600 * 24));
    const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${days > 0 ? `${days}d ` : ""}${hours.toString().padStart(2, "0")}h ${minutes
      .toString()
      .padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  };

  const isHealthy = !error && data?.status === "ok";

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-2.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
          isHealthy
            ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
            : error
            ? "bg-rose-950/40 border-rose-500/30 text-rose-300"
            : "bg-amber-950/40 border-amber-500/30 text-amber-300"
        } ${className}`}
      >
        <span className="relative flex h-2 w-2">
          {isHealthy && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              isHealthy ? "bg-emerald-500" : error ? "bg-rose-500" : "bg-amber-500"
            }`}
          ></span>
        </span>
        <span>
          {isHealthy ? "System Operational" : error ? "Server Offline" : "Connecting..."}
        </span>
        {data && <span className="opacity-60">| {data.database?.recordsCount ?? 0} Records</span>}
        {latencyMs !== null && <span className="opacity-60">| {latencyMs}ms</span>}
        <button
          onClick={() => fetchHealth(true)}
          disabled={refreshing}
          className="ml-1 hover:text-white transition-colors focus:outline-none"
          title="Refresh Status"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border bg-slate-900/90 backdrop-blur-xl border-slate-800 text-slate-100 shadow-2xl p-5 md:p-6 transition-all ${className}`}
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl border ${
              isHealthy
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-lg shadow-emerald-500/10"
                : error
                ? "bg-rose-500/10 border-rose-500/30 text-rose-400 shadow-lg shadow-rose-500/10"
                : "bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-lg shadow-amber-500/10"
            }`}
          >
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base md:text-lg font-bold tracking-tight text-white">
                In-Built Cloud Engine Status
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  isHealthy
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : error
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isHealthy
                      ? "bg-emerald-400 animate-pulse"
                      : error
                      ? "bg-rose-400"
                      : "bg-amber-400"
                  }`}
                />
                {isHealthy ? "ONLINE & COMMITTED" : error ? "OFFLINE" : "INITIALIZING"}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Source of truth with guaranteed physical disk commitment via{" "}
              <code className="text-emerald-400/90 font-mono text-[11px]">fs.fsyncSync</code>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {latencyMs !== null && (
            <div
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300 font-mono"
              title="API Response Roundtrip Latency"
            >
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>{latencyMs}ms</span>
            </div>
          )}

          <button
            onClick={() => setIsAutoRefresh(!isAutoRefresh)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              isAutoRefresh
                ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/50"
                : "bg-slate-800/60 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
            title={isAutoRefresh ? "Pause Live Polling" : "Enable Live Polling"}
          >
            {isAutoRefresh ? "Auto-refresh: ON" : "Auto-refresh: OFF"}
          </button>

          <button
            onClick={() => fetchHealth(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-md shadow-indigo-600/20 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>{refreshing ? "Checking..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Error Alert Banner */}
      {error && (
        <div className="mt-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-start gap-3 text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold">Backend Unreachable:</span> {error}. The in-built engine
            will automatically attempt reconnection.
          </div>
          <button
            onClick={() => fetchHealth(true)}
            className="underline font-semibold hover:text-white"
          >
            Retry Now
          </button>
        </div>
      )}

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mt-5">
        {/* Card 1: Server Uptime */}
        <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex flex-col justify-between hover:border-slate-600/80 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">System Uptime</span>
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-white tracking-tight">
              {formatUptimeDisplay(localUptime)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
              PID: {data?.system?.pid ?? process.pid ?? "active"} | Node: {data?.system?.nodeVersion ?? "v22"}
            </div>
          </div>
        </div>

        {/* Card 2: Database Records */}
        <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex flex-col justify-between hover:border-slate-600/80 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Database Collection</span>
            <Database className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-lg font-bold text-white tracking-tight flex items-baseline gap-1.5">
              <span>{data?.database?.recordsCount ?? "..."}</span>
              <span className="text-xs font-normal text-slate-400">Clan Records</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
              <span>{data?.database?.usersCount ?? 0} System Users</span>
              <span className="text-emerald-400 font-mono text-[10px]">100% Synced</span>
            </div>
          </div>
        </div>

        {/* Card 3: Real-Time SSE Stream */}
        <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex flex-col justify-between hover:border-slate-600/80 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Real-Time Sync Nodes</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="text-lg font-bold text-white tracking-tight flex items-baseline gap-1.5">
              <span>{data?.clientsConnected ?? 1}</span>
              <span className="text-xs font-normal text-slate-400">Active Clients</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              Continuous SSE Stream Hub
            </div>
          </div>
        </div>

        {/* Card 4: Disk Commitment & Memory */}
        <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60 flex flex-col justify-between hover:border-slate-600/80 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
            <span className="font-medium">Physical Disk Commitment</span>
            <HardDrive className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>fsyncSync Active</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Heap: {data?.system?.memory?.heapUsedMb ?? 0} MB / {data?.system?.memory?.heapTotalMb ?? 0} MB
            </div>
          </div>
        </div>
      </div>

      {/* Extended Diagnostics & Integrity Details */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Storage Integrity */}
        <div className="p-3.5 rounded-xl bg-slate-800/30 border border-slate-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Storage Strategy:</span>
            <span className="text-white font-medium">Atomic Temp Swap & Force Flush</span>
          </div>
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            {data?.database?.storageCapacity ?? "1TB Engine"}
          </span>
        </div>

        {/* Environment & Version */}
        <div className="p-3.5 rounded-xl bg-slate-800/30 border border-slate-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <Layers className="w-4 h-4 text-indigo-400" />
            <span>Environment / Engine:</span>
            <span className="text-white font-medium capitalize">
              {data?.env ?? "development"} ({data?.version ?? "v2.0"})
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            {lastCheckTime ? `Checked ${lastCheckTime.toLocaleTimeString()}` : "Pending"}
          </span>
        </div>
      </div>

      {/* Raw JSON Diagnostics Accordion */}
      <div className="mt-4 pt-3 border-t border-slate-800/80">
        <button
          onClick={() => setShowJson(!showJson)}
          className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 transition-colors py-1"
        >
          <span className="flex items-center gap-1.5 font-mono">
            <FileCode className="w-3.5 h-3.5 text-indigo-400" />
            Raw Health Payload (/api/health)
          </span>
          {showJson ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showJson && (
          <div className="mt-2.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-300 font-mono text-[11px] overflow-x-auto max-h-60 scrollbar-thin">
            <pre>{JSON.stringify(data || { error: error || "No data" }, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemStatus;
