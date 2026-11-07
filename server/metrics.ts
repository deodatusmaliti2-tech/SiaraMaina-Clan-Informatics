import { dbEngine } from "./db";

interface SystemMetrics {
  uptimeSeconds: number;
  uptimeFormatted: string;
  requests: {
    total: number;
    reads: number;
    writes: number;
    errors: number;
  };
  bandwidth: {
    inboundBytes: number;
    outboundBytes: number;
    inboundFormatted: string;
    outboundFormatted: string;
  };
  latency: {
    averageMs: number;
    recentMs: number[];
  };
  storage: {
    databaseSizeBytes: number;
    databaseSizeFormatted: string;
    maxStorageCapacity: string;
    totalRecords: number;
    totalUsers: number;
  };
  status: "OPTIMAL" | "DEGRADED" | "HEALTHY";
}

class TelemetryMetricsEngine {
  private startTime: number = Date.now();
  private totalRequests: number = 0;
  private readRequests: number = 0;
  private writeRequests: number = 0;
  private errorRequests: number = 0;
  private inboundBytes: number = 0;
  private outboundBytes: number = 0;
  private latencies: number[] = [];

  public recordRequest(method: string, bytesIn: number = 0) {
    this.totalRequests++;
    this.inboundBytes += bytesIn;
    if (method === "GET") this.readRequests++;
    else this.writeRequests++;
  }

  public recordResponse(status: number, durationMs: number, bytesOut: number = 0) {
    this.outboundBytes += bytesOut;
    this.latencies.push(durationMs);
    if (this.latencies.length > 50) this.latencies.shift();
    if (status >= 400) this.errorRequests++;
  }

  public getMetrics(): SystemMetrics {
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    const avgLatency =
      this.latencies.length > 0
        ? Math.round((this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length) * 10) / 10
        : 1.2;

    const stats = dbEngine.getStats();

    return {
      uptimeSeconds: uptimeSec,
      uptimeFormatted: this.formatUptime(uptimeSec),
      requests: {
        total: this.totalRequests,
        reads: this.readRequests,
        writes: this.writeRequests,
        errors: this.errorRequests,
      },
      bandwidth: {
        inboundBytes: this.inboundBytes,
        outboundBytes: this.outboundBytes,
        inboundFormatted: this.formatBytes(this.inboundBytes),
        outboundFormatted: this.formatBytes(this.outboundBytes),
      },
      latency: {
        averageMs: avgLatency,
        recentMs: this.latencies.slice(-10),
      },
      storage: {
        databaseSizeBytes: stats.databaseSizeBytes,
        databaseSizeFormatted: stats.databaseSizeFormatted,
        maxStorageCapacity: stats.maxStorageCapacity,
        totalRecords: stats.totalRecords,
        totalUsers: stats.totalUsers,
      },
      status: this.errorRequests > 20 ? "DEGRADED" : "OPTIMAL",
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(2) + " MB";
  }

  private formatUptime(sec: number): string {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
}

export const metricsEngine = new TelemetryMetricsEngine();
