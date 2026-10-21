export function isStandardEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const clean = email.trim().toLowerCase();
  if (clean.length < 6 || clean.length > 254) return false;
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(
    clean
  );
}

const TOKEN_KEY = "auth_token";

export interface BackendUser {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  branch?: string;
  institution?: string;
  active?: boolean;
  createdAt?: string;
  lastLogin?: string;
}

class BackendApiService {
  private token: string | null = null;
  private eventSource: EventSource | null = null;
  private syncListeners: Set<(event: string, data: any) => void> = new Set();
  private reconnectTimeout: any = null;

  constructor() {
    if (typeof window !== "undefined") {
      this.token = localStorage.getItem(TOKEN_KEY);
      this.initRealtimeStream();
    }
  }

  public setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }

  public initRealtimeStream() {
    if (typeof window === "undefined") return;
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {}
    }

    try {
      this.eventSource = new EventSource("/api/sync/stream");

      const events = [
        "handshake",
        "ping",
        "doc_change",
        "auth_change",
        "login_notification",
        "security_alert",
        "sync_pulse",
        "spreadsheet_config_changed",
      ];

      events.forEach((name) => {
        this.eventSource?.addEventListener(name, (e: MessageEvent) => {
          try {
            const parsed = JSON.parse(e.data);
            this.notifyListeners(name, parsed);
          } catch {
            this.notifyListeners(name, e.data);
          }
        });
      });

      this.eventSource.onerror = () => {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
          this.initRealtimeStream();
        }, 3000);
      };
    } catch (err) {
      console.warn("[BackendApi] EventSource init note:", err);
    }
  }

  public subscribe(callback: (event: string, data: any) => void) {
    this.syncListeners.add(callback);
    return () => this.syncListeners.delete(callback);
  }

  private notifyListeners(event: string, data: any) {
    this.syncListeners.forEach((cb) => {
      try {
        cb(event, data);
      } catch (err) {
        console.warn("[BackendApi] Listener callback notice:", err);
      }
    });
  }

  public async login(email: string, pass: string) {
    if (!isStandardEmail(email)) {
      throw new Error("NON_STANDARD_EMAIL: Valid standard email required.");
    }
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    this.setToken(data.token);
    return data;
  }

  public async register(payload: {
    email: string;
    password?: string;
    displayName?: string;
    role?: string;
    branch?: string;
  }) {
    if (!isStandardEmail(payload.email)) {
      throw new Error("NON_STANDARD_EMAIL: Valid standard email required.");
    }
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Registration failed");
    return data;
  }

  public async getUsers(): Promise<BackendUser[]> {
    const res = await fetch("/api/auth/users", { headers: this.getHeaders() });
    const data = await res.json();
    return data.users || [];
  }

  public async getCollection<T = any>(collection: string): Promise<T[]> {
    const res = await fetch(`/api/db/collections/${collection}`, { headers: this.getHeaders() });
    const data = await res.json();
    return data.data || [];
  }

  public async getDocument<T = any>(collection: string, id: string): Promise<T | null> {
    const res = await fetch(`/api/db/collections/${collection}/${id}`, { headers: this.getHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return data.doc || null;
  }

  public async saveDocument<T = any>(collection: string, id: string, docData: T): Promise<T> {
    const res = await fetch(`/api/db/collections/${collection}`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ id, data: docData }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save document");
    return data.doc;
  }

  public async deleteDocument(collection: string, id: string): Promise<boolean> {
    const res = await fetch(`/api/db/collections/${collection}/${id}`, {
      method: "DELETE",
      headers: this.getHeaders(),
    });
    const data = await res.json();
    return data.success === true;
  }

  public async syncRecords(records: any[], author?: string): Promise<any> {
    const res = await fetch("/api/db/sync/records", {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ records, author }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Bulk sync failed");
    return data;
  }

  public async triggerBackup(): Promise<any> {
    const res = await fetch("/api/db/backup", {
      method: "POST",
      headers: this.getHeaders(),
    });
    return await res.json();
  }

  public async getMetrics(): Promise<any> {
    const res = await fetch("/api/metrics", { headers: this.getHeaders() });
    return await res.json();
  }

  public async getPulse(): Promise<any> {
    const res = await fetch("/api/db/pulse", { headers: this.getHeaders() });
    return await res.json();
  }
}

export const backendApi = new BackendApiService();

if (typeof window !== "undefined") {
  (window as any).backendApi = backendApi;
}
