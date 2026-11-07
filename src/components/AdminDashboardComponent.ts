import { BackendApiService } from "../services/backendApi";

export interface DatabaseStats {
  totalRecords: number;
  totalMembers: number;
  totalUsers: number;
  totalAuditLogs: number;
  adminCount: number;
  editorCount: number;
  viewerCount: number;
  suspendedCount: number;
  serverStatus: string;
  uptimeFormatted?: string;
  storageFormatted?: string;
}

export interface UserItem {
  id?: string;
  uid?: string;
  email: string;
  displayName?: string;
  role?: string;
  branch?: string;
  active?: boolean;
  createdAt?: string;
  lastLogin?: string;
}

export interface AuditLogItem {
  id?: string;
  timestamp: string;
  eventType: string;
  summary: string;
  actorEmail?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * AdminDashboardComponent
 * Displays database statistics fetched from the server using backendApi.getCollection
 * and provides a visual overview of registered users and audit logs.
 */
export class AdminDashboardComponent {
  private container: HTMLElement | null = null;
  private users: UserItem[] = [];
  private auditLogs: AuditLogItem[] = [];
  private stats: DatabaseStats = {
    totalRecords: 0,
    totalMembers: 0,
    totalUsers: 0,
    totalAuditLogs: 0,
    adminCount: 0,
    editorCount: 0,
    viewerCount: 0,
    suspendedCount: 0,
    serverStatus: "INITIALIZING",
  };
  private activeTab: "overview" | "users" | "audit" = "overview";
  private unsubscribe: (() => void) | null = null;
  private searchQuery: string = "";
  private roleFilter: string = "all";
  private isLoading: boolean = true;

  constructor(
    private backendApi: BackendApiService,
    private targetElementId?: string
  ) {
    if (targetElementId) {
      this.mount(targetElementId);
    }
  }

  public mount(target: HTMLElement | string) {
    if (typeof target === "string") {
      this.container = document.getElementById(target);
    } else if (target instanceof HTMLElement) {
      this.container = target;
    }

    if (!this.container) return;

    this.renderSkeleton();
    this.loadAllData();

    // Subscribe to SSE doc_change and auth_change for real-time reactivity
    this.unsubscribe = this.backendApi.subscribe((event: string, payload: any) => {
      if (event === "doc_change" || event === "auth_change" || event === "login_notification") {
        if (payload?.collection === "users" || payload?.collection === "auditLogs" || payload?.collection === "records") {
          this.loadAllData();
        }
      }
    });
  }

  public async loadAllData() {
    this.isLoading = true;
    try {
      // Fetch database collections using backendApi.getCollection
      const [users, records, auditLogs, authAuditLogs] = await Promise.all([
        this.backendApi.getCollection<UserItem>("users").catch(() => []),
        this.backendApi.getCollection<any>("records").catch(() => []),
        this.backendApi.getCollection<AuditLogItem>("auditLogs").catch(() => []),
        this.backendApi.getCollection<AuditLogItem>("authAuditLogs").catch(() => []),
      ]);

      this.users = Array.isArray(users) ? users : [];

      // Combine general and auth security audit logs
      const combined = [
        ...(Array.isArray(auditLogs) ? auditLogs : []),
        ...(Array.isArray(authAuditLogs) ? authAuditLogs : []),
      ];

      combined.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      this.auditLogs = combined;

      // Compute statistics
      const adminCount = this.users.filter((u) => u.role === "admin").length;
      const editorCount = this.users.filter((u) => u.role === "editor").length;
      const viewerCount = this.users.filter((u) => !u.role || u.role === "viewer").length;
      const suspendedCount = this.users.filter((u) => u.active === false).length;

      this.stats = {
        totalRecords: Array.isArray(records) ? records.length : 0,
        totalMembers: Array.isArray(records) ? records.length : 0,
        totalUsers: this.users.length,
        totalAuditLogs: this.auditLogs.length,
        adminCount,
        editorCount,
        viewerCount,
        suspendedCount,
        serverStatus: "ONLINE_SYNCHRONIZED",
      };

      this.isLoading = false;
      this.render();
    } catch (err: any) {
      console.error("[AdminDashboard] Error loading collections:", err);
      this.isLoading = false;
      this.render();
    }
  }

  public setTab(tab: "overview" | "users" | "audit") {
    this.activeTab = tab;
    this.render();
  }

  public setSearchQuery(query: string) {
    this.searchQuery = query.toLowerCase().trim();
    this.render();
  }

  public setRoleFilter(role: string) {
    this.roleFilter = role;
    this.render();
  }

  private renderSkeleton() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="padding:24px; text-align:center; color:#5c5a4d; font-family:sans-serif;">
        <div style="font-size:2rem; margin-bottom:8px;">⏳</div>
        <div style="font-size:0.95rem; font-weight:700;">Loading Admin Database Statistics &amp; Logs...</div>
        <div style="font-size:0.75rem; color:#8c827a; margin-top:4px;">Connecting to In-Built Atomic Database Engine via backendApi...</div>
      </div>
    `;
  }

  public render() {
    if (!this.container) return;

    const filteredUsers = this.users.filter((u) => {
      const matchSearch =
        !this.searchQuery ||
        (u.displayName || "").toLowerCase().includes(this.searchQuery) ||
        (u.email || "").toLowerCase().includes(this.searchQuery) ||
        (u.branch || "").toLowerCase().includes(this.searchQuery);
      const matchRole =
        this.roleFilter === "all" || (u.role || "viewer") === this.roleFilter;
      return matchSearch && matchRole;
    });

    this.container.innerHTML = `
      <div class="admin-dashboard-root" style="font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#103d2b; background:#fff; border-radius:12px; border:1px solid #d2e4d7; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        <!-- Dashboard Header -->
        <div style="padding:16px 20px; background:#103d2b; color:#fff; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:36px; height:36px; border-radius:8px; background:#e9bf52; color:#103d2b; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:1.1rem;">🛡️</div>
            <div>
              <h2 style="margin:0; font-size:1.15rem; font-weight:800; color:#fff;">Admin Informatics Dashboard</h2>
              <p style="margin:0; font-size:0.72rem; color:#d2e4d7;">Live in-built database collections, user profiles &amp; security audit trails</p>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="display:inline-flex; align-items:center; gap:5px; background:rgba(255,255,255,0.15); padding:4px 10px; border-radius:16px; font-size:0.7rem; font-weight:700;">
              <span style="width:7px; height:7px; border-radius:50%; background:#10b981;"></span>
              ${this.stats.serverStatus}
            </span>
            <button id="adminRefreshBtn" style="background:#e9bf52; color:#103d2b; border:none; border-radius:6px; padding:6px 12px; font-size:0.72rem; font-weight:800; cursor:pointer;" type="button">🔄 Refresh Data</button>
          </div>
        </div>

        <!-- Metric KPI Cards -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; padding:16px 20px; background:#f4f9f5; border-bottom:1px solid #d2e4d7;">
          <div style="background:#fff; border:1px solid #c2dec9; border-radius:8px; padding:12px; display:flex; align-items:center; gap:10px;">
            <div style="font-size:1.6rem;">📜</div>
            <div>
              <div style="font-size:0.68rem; color:#64748b; font-weight:700; text-transform:uppercase;">Clan Records</div>
              <div style="font-size:1.35rem; font-weight:900; color:#103d2b;">${this.stats.totalRecords}</div>
            </div>
          </div>

          <div style="background:#fff; border:1px solid #c2dec9; border-radius:8px; padding:12px; display:flex; align-items:center; gap:10px;">
            <div style="font-size:1.6rem;">👥</div>
            <div>
              <div style="font-size:0.68rem; color:#64748b; font-weight:700; text-transform:uppercase;">Total Users</div>
              <div style="font-size:1.35rem; font-weight:900; color:#103d2b;">${this.stats.totalUsers}</div>
            </div>
          </div>

          <div style="background:#fff; border:1px solid #fed7aa; border-radius:8px; padding:12px; display:flex; align-items:center; gap:10px;">
            <div style="font-size:1.6rem;">🛡️</div>
            <div>
              <div style="font-size:0.68rem; color:#9a3412; font-weight:700; text-transform:uppercase;">Administrators</div>
              <div style="font-size:1.35rem; font-weight:900; color:#c2410c;">${this.stats.adminCount}</div>
            </div>
          </div>

          <div style="background:#fff; border:1px solid #bae6fd; border-radius:8px; padding:12px; display:flex; align-items:center; gap:10px;">
            <div style="font-size:1.6rem;">✏️</div>
            <div>
              <div style="font-size:0.68rem; color:#0369a1; font-weight:700; text-transform:uppercase;">Editors / Viewers</div>
              <div style="font-size:1.35rem; font-weight:900; color:#0284c7;">${this.stats.editorCount} / ${this.stats.viewerCount}</div>
            </div>
          </div>

          <div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:12px; display:flex; align-items:center; gap:10px;">
            <div style="font-size:1.6rem;">📋</div>
            <div>
              <div style="font-size:0.68rem; color:#64748b; font-weight:700; text-transform:uppercase;">Audit Events</div>
              <div style="font-size:1.35rem; font-weight:900; color:#334155;">${this.stats.totalAuditLogs}</div>
            </div>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div style="display:flex; border-bottom:1px solid #e2e8f0; background:#fafafa; padding:0 20px;">
          <button id="adminTabOverview" style="padding:10px 16px; border:none; background:none; font-size:0.8rem; font-weight:700; cursor:pointer; color:${this.activeTab === "overview" ? "#103d2b" : "#64748b"}; border-bottom:${this.activeTab === "overview" ? "3px solid #103d2b" : "3px solid transparent"};" type="button">
            📊 Database Overview
          </button>
          <button id="adminTabUsers" style="padding:10px 16px; border:none; background:none; font-size:0.8rem; font-weight:700; cursor:pointer; color:${this.activeTab === "users" ? "#103d2b" : "#64748b"}; border-bottom:${this.activeTab === "users" ? "3px solid #103d2b" : "3px solid transparent"};" type="button">
            👥 Registered Users (${this.users.length})
          </button>
          <button id="adminTabAudit" style="padding:10px 16px; border:none; background:none; font-size:0.8rem; font-weight:700; cursor:pointer; color:${this.activeTab === "audit" ? "#103d2b" : "#64748b"}; border-bottom:${this.activeTab === "audit" ? "3px solid #103d2b" : "3px solid transparent"};" type="button">
            📜 Security &amp; Audit Logs (${this.auditLogs.length})
          </button>
        </div>

        <!-- Tab Body Content -->
        <div style="padding:20px;">
          ${this.activeTab === "overview" ? this.renderOverviewSection() : ""}
          ${this.activeTab === "users" ? this.renderUsersSection(filteredUsers) : ""}
          ${this.activeTab === "audit" ? this.renderAuditSection() : ""}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderOverviewSection(): string {
    return `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px;">
          <h4 style="margin:0 0 12px 0; font-size:0.9rem; color:#103d2b; display:flex; align-items:center; gap:6px;">
            <span>🗄️</span> Database Collection Topology
          </h4>
          <ul style="margin:0; padding-left:20px; font-size:0.8rem; line-height:1.8; color:#334155;">
            <li><strong>records:</strong> ${this.stats.totalRecords} documents (Genealogical records &amp; profiles)</li>
            <li><strong>users:</strong> ${this.stats.totalUsers} registered user documents</li>
            <li><strong>auditLogs:</strong> ${this.stats.totalAuditLogs} recorded access and security events</li>
            <li><strong>Persistence:</strong> Atomic Queued JSON Engine (Zero file corruption)</li>
            <li><strong>Sync Protocol:</strong> Server-Sent Events (SSE) Multi-Client Bus</li>
          </ul>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px;">
          <h4 style="margin:0 0 12px 0; font-size:0.9rem; color:#103d2b; display:flex; align-items:center; gap:6px;">
            <span>🛡️</span> Security &amp; Role-Based Access Distribution
          </h4>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; font-size:0.75rem;">
              <span>Administrators (Full Authority):</span>
              <strong style="color:#c2410c;">${this.stats.adminCount}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.75rem;">
              <span>Editors (Update &amp; Profile Access):</span>
              <strong style="color:#0284c7;">${this.stats.editorCount}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.75rem;">
              <span>Viewers (Read-Only Members):</span>
              <strong style="color:#103d2b;">${this.stats.viewerCount}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.75rem;">
              <span>Suspended Profiles:</span>
              <strong style="color:#ef4444;">${this.stats.suspendedCount}</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderUsersSection(users: UserItem[]): string {
    return `
      <div>
        <!-- Search and Filter Toolbar -->
        <div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
          <input id="adminUserSearch" type="search" placeholder="🔍 Search by name, email, or branch..." value="${escapeHtml(this.searchQuery)}" style="flex:1; min-width:220px; padding:8px 12px; font-size:0.78rem; border:1px solid #cbd5e1; border-radius:6px;">
          <select id="adminRoleFilter" style="padding:8px 12px; font-size:0.78rem; border:1px solid #cbd5e1; border-radius:6px; background:#fff;">
            <option value="all" ${this.roleFilter === "all" ? "selected" : ""}>All Roles</option>
            <option value="admin" ${this.roleFilter === "admin" ? "selected" : ""}>Administrators</option>
            <option value="editor" ${this.roleFilter === "editor" ? "selected" : ""}>Editors</option>
            <option value="viewer" ${this.roleFilter === "viewer" ? "selected" : ""}>Viewers</option>
          </select>
        </div>

        <!-- Users Table -->
        <div style="border:1px solid #e2e8f0; border-radius:8px; overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.75rem;">
            <thead>
              <tr style="background:#f1f5f9; border-bottom:1px solid #cbd5e1;">
                <th style="padding:10px 12px;">Display Name</th>
                <th style="padding:10px 12px;">Email Address</th>
                <th style="padding:10px 12px;">Role</th>
                <th style="padding:10px 12px;">Branch</th>
                <th style="padding:10px 12px;">Account Status</th>
              </tr>
            </thead>
            <tbody>
              ${
                users.length === 0
                  ? `<tr><td colspan="5" style="padding:20px; text-align:center; color:#64748b;">No matching users found in registry.</td></tr>`
                  : users
                      .map((u) => {
                        const role = u.role || "viewer";
                        const roleColor =
                          role === "admin"
                            ? "#c2410c; background:#ffedd5;"
                            : role === "editor"
                            ? "#0284c7; background:#e0f2fe;"
                            : "#15803d; background:#dcfce7;";
                        return `
                          <tr style="border-bottom:1px solid #f1f5f9;">
                            <td style="padding:8px 12px; font-weight:700; color:#103d2b;">
                              ${escapeHtml(u.displayName || "Member")}
                            </td>
                            <td style="padding:8px 12px; font-family:monospace; color:#334155;">
                              ${escapeHtml(u.email)}
                            </td>
                            <td style="padding:8px 12px;">
                              <span style="display:inline-block; padding:2px 8px; border-radius:12px; font-size:0.68rem; font-weight:800; color:${roleColor}">
                                ${role.toUpperCase()}
                              </span>
                            </td>
                            <td style="padding:8px 12px; color:#64748b;">
                              ${escapeHtml(u.branch || "General")}
                            </td>
                            <td style="padding:8px 12px;">
                              ${
                                u.active !== false
                                  ? `<span style="color:#16a34a; font-weight:700;">🟢 Active</span>`
                                  : `<span style="color:#dc2626; font-weight:700;">🔴 Suspended</span>`
                              }
                            </td>
                          </tr>
                        `;
                      })
                      .join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private renderAuditSection(): string {
    return `
      <div>
        <div style="border:1px solid #e2e8f0; border-radius:8px; overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.75rem;">
            <thead>
              <tr style="background:#f1f5f9; border-bottom:1px solid #cbd5e1;">
                <th style="padding:10px 12px; width:170px;">Timestamp</th>
                <th style="padding:10px 12px; width:130px;">Event Type</th>
                <th style="padding:10px 12px;">Summary</th>
                <th style="padding:10px 12px; width:180px;">Actor / User</th>
              </tr>
            </thead>
            <tbody>
              ${
                this.auditLogs.length === 0
                  ? `<tr><td colspan="4" style="padding:20px; text-align:center; color:#64748b;">No security audit events recorded.</td></tr>`
                  : this.auditLogs
                      .map((log) => {
                        let dateStr = "Recent";
                        try {
                          if (log.timestamp) dateStr = new Date(log.timestamp).toLocaleString();
                        } catch {}
                        const isAlert = (log.eventType || "").includes("ALERT") || (log.eventType || "").includes("DENIED");
                        return `
                          <tr style="border-bottom:1px solid #f1f5f9; ${isAlert ? "background:#fff1f2;" : ""}">
                            <td style="padding:8px 12px; color:#64748b; font-size:0.7rem; white-space:nowrap;">
                              ${escapeHtml(dateStr)}
                            </td>
                            <td style="padding:8px 12px;">
                              <span style="display:inline-block; font-size:0.65rem; font-weight:800; padding:2px 6px; border-radius:4px; ${
                                isAlert ? "background:#ffe4e6; color:#be123c;" : "background:#e0f2fe; color:#0369a1;"
                              }">
                                ${escapeHtml(log.eventType || "LOG")}
                              </span>
                            </td>
                            <td style="padding:8px 12px; font-weight:600; color:#103d2b;">
                              ${escapeHtml(log.summary || "")}
                            </td>
                            <td style="padding:8px 12px; font-family:monospace; font-size:0.7rem; color:#475569;">
                              ${escapeHtml(log.actorEmail || "system")}
                            </td>
                          </tr>
                        `;
                      })
                      .join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private bindEvents() {
    if (!this.container) return;

    const refreshBtn = this.container.querySelector("#adminRefreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => this.loadAllData());
    }

    const tabOverview = this.container.querySelector("#adminTabOverview");
    if (tabOverview) {
      tabOverview.addEventListener("click", () => this.setTab("overview"));
    }

    const tabUsers = this.container.querySelector("#adminTabUsers");
    if (tabUsers) {
      tabUsers.addEventListener("click", () => this.setTab("users"));
    }

    const tabAudit = this.container.querySelector("#adminTabAudit");
    if (tabAudit) {
      tabAudit.addEventListener("click", () => this.setTab("audit"));
    }

    const searchInput = this.container.querySelector("#adminUserSearch") as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase().trim();
        const usersTable = this.renderUsersSection(
          this.users.filter((u) => {
            const matchSearch =
              !this.searchQuery ||
              (u.displayName || "").toLowerCase().includes(this.searchQuery) ||
              (u.email || "").toLowerCase().includes(this.searchQuery) ||
              (u.branch || "").toLowerCase().includes(this.searchQuery);
            const matchRole =
              this.roleFilter === "all" || (u.role || "viewer") === this.roleFilter;
            return matchSearch && matchRole;
          })
        );
        // Replace inner users view if active
        if (this.activeTab === "users") {
          const body = this.container?.querySelector("div[style*='padding:20px;']");
          if (body) {
            body.innerHTML = usersTable;
            this.bindUsersToolbar();
          }
        }
      });
    }

    const roleFilterEl = this.container.querySelector("#adminRoleFilter") as HTMLSelectElement;
    if (roleFilterEl) {
      roleFilterEl.addEventListener("change", (e) => {
        this.roleFilter = (e.target as HTMLSelectElement).value;
        this.render();
      });
    }
  }

  private bindUsersToolbar() {
    if (!this.container) return;
    const searchInput = this.container.querySelector("#adminUserSearch") as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase().trim();
        this.render();
      });
    }
    const roleFilterEl = this.container.querySelector("#adminRoleFilter") as HTMLSelectElement;
    if (roleFilterEl) {
      roleFilterEl.addEventListener("change", (e) => {
        this.roleFilter = (e.target as HTMLSelectElement).value;
        this.render();
      });
    }
  }

  public destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
