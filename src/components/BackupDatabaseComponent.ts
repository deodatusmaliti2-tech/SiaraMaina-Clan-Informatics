/**
 * BackupDatabaseComponent.ts
 * Dedicated Interactive UI Component for triggering atomic JSON snapshots
 * and managing database backups on the In-Built Server Engine.
 */

export interface BackupItem {
  filename: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
}

export interface BackupResponse {
  success: boolean;
  message: string;
  filename: string;
  backups?: BackupItem[];
}

export class BackupDatabaseComponent {
  private containerId: string;
  private isBackingUp: boolean = false;
  private backups: BackupItem[] = [];

  constructor(containerId: string = "backupDatabaseContainer") {
    this.containerId = containerId;
  }

  public async fetchBackups(): Promise<BackupItem[]> {
    try {
      const res = await fetch("/api/db/backups");
      const data = await res.json();
      if (res.ok && data.success) {
        this.backups = data.backups || [];
        return this.backups;
      }
    } catch (err) {
      console.warn("[BackupDatabaseComponent] fetchBackups note:", err);
    }
    return [];
  }

  public async triggerBackup(onSuccess?: (res: BackupResponse) => void, onError?: (err: Error) => void): Promise<BackupResponse | null> {
    if (this.isBackingUp) return null;
    this.isBackingUp = true;
    this.updateButtonState(true);

    try {
      const res = await fetch("/api/db/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data: BackupResponse = await res.json();
      if (res.ok && data.success) {
        if (data.backups) this.backups = data.backups;
        else await this.fetchBackups();

        this.showSuccessFeedback(data);
        if (onSuccess) onSuccess(data);
        return data;
      } else {
        throw new Error((data as any).error || "Backup failed.");
      }
    } catch (err: any) {
      this.showErrorFeedback(err.message || "Failed to trigger backup.");
      if (onError) onError(err);
      return null;
    } finally {
      this.isBackingUp = false;
      this.updateButtonState(false);
    }
  }

  public render(containerElement?: HTMLElement): HTMLElement {
    const el = containerElement || document.getElementById(this.containerId) || document.createElement("div");
    el.id = this.containerId;
    el.innerHTML = `
      <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:16px; padding:24px; box-shadow:0 4px 20px rgba(0,0,0,0.06); font-family:system-ui,-apple-system,sans-serif;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; border-bottom:1px solid #f1f5f9; padding-bottom:14px;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:44px; height:44px; border-radius:12px; background:#ecfdf5; display:flex; align-items:center; justify-content:center; font-size:1.4rem; border:1px solid #a7f3d0;">📦</div>
            <div>
              <h3 style="margin:0; font-size:1.1rem; color:#064e3b; font-weight:800;">In-Built Database Backup & Snapshots</h3>
              <p style="margin:2px 0 0 0; font-size:0.8rem; color:#64748b;">Zero-lock atomic snapshots of <code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:0.75rem;">cloud_database.json</code></p>
            </div>
          </div>
          <div style="text-align:right;">
            <span style="display:inline-block; padding:4px 10px; background:#dcfce7; color:#166534; border-radius:99px; font-size:0.75rem; font-weight:700;">🟢 Online &amp; Synchronized</span>
          </div>
        </div>

        <!-- Success/Error Feedback Banner Slot -->
        <div id="${this.containerId}_feedback" style="display:none; margin-bottom:16px;"></div>

        <!-- Action Bar -->
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-bottom:20px;">
          <div>
            <div style="font-weight:700; font-size:0.88rem; color:#1e293b;">Create Atomic Database Snapshot</div>
            <div style="font-size:0.78rem; color:#64748b; margin-top:2px;">Safely writes current records, users, and audit logs to <code style="color:#0f766e;">data/backups/</code></div>
          </div>
          <button id="${this.containerId}_triggerBtn" type="button" style="display:inline-flex; align-items:center; gap:8px; background:#059669; color:#ffffff; border:none; padding:10px 20px; font-size:0.85rem; font-weight:700; border-radius:8px; cursor:pointer; box-shadow:0 2px 6px rgba(5,150,105,0.3); transition:all 0.2s ease;">
            <span>⚡</span> <span id="${this.containerId}_triggerBtnText">Trigger Atomic Backup</span>
          </button>
        </div>

        <!-- Snapshot History Section -->
        <div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <h4 style="margin:0; font-size:0.85rem; color:#475569; text-transform:uppercase; letter-spacing:0.05em;">Recent Backup Snapshots</h4>
            <button id="${this.containerId}_refreshBtn" type="button" style="background:none; border:none; color:#059669; font-size:0.75rem; font-weight:700; cursor:pointer;">🔄 Refresh List</button>
          </div>
          <div id="${this.containerId}_list" style="max-height:220px; overflow-y:auto; border:1px solid #f1f5f9; border-radius:8px;">
            <div style="padding:16px; text-align:center; color:#94a3b8; font-size:0.8rem;">Loading snapshots...</div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents(el);
    this.fetchBackups().then(() => this.renderList(el));
    return el;
  }

  private bindEvents(root: HTMLElement) {
    const btn = root.querySelector(`#${this.containerId}_triggerBtn`);
    if (btn) {
      btn.addEventListener("click", () => this.triggerBackup());
    }
    const refreshBtn = root.querySelector(`#${this.containerId}_refreshBtn`);
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        await this.fetchBackups();
        this.renderList(root);
      });
    }
  }

  private updateButtonState(loading: boolean) {
    const btn = document.getElementById(`${this.containerId}_triggerBtn`) as HTMLButtonElement | null;
    const btnText = document.getElementById(`${this.containerId}_triggerBtnText`);
    if (btn && btnText) {
      btn.disabled = loading;
      if (loading) {
        btn.style.opacity = "0.75";
        btn.style.background = "#047857";
        btnText.textContent = "Creating Snapshot...";
      } else {
        btn.style.opacity = "1";
        btn.style.background = "#059669";
        btnText.textContent = "Trigger Atomic Backup";
      }
    }
  }

  private showSuccessFeedback(data: BackupResponse) {
    const feedback = document.getElementById(`${this.containerId}_feedback`);
    if (feedback) {
      feedback.style.display = "block";
      feedback.innerHTML = `
        <div style="background:#ecfdf5; border:1px solid #6ee7b7; color:#065f46; border-radius:10px; padding:12px 16px; font-size:0.82rem; display:flex; align-items:center; justify-content:space-between; animation:fadeIn 0.3s ease;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:1.2rem;">✅</span>
            <div>
              <div style="font-weight:800;">Atomic Snapshot Created Successfully!</div>
              <div style="font-size:0.75rem; color:#047857; margin-top:2px;">File: <code>${data.filename}</code> • Saved in <code>data/backups/</code></div>
            </div>
          </div>
          <button type="button" onclick="this.parentElement.parentElement.style.display='none'" style="background:none; border:none; font-size:1.1rem; color:#065f46; cursor:pointer;">×</button>
        </div>
      `;
      this.renderList();
    }
  }

  private showErrorFeedback(msg: string) {
    const feedback = document.getElementById(`${this.containerId}_feedback`);
    if (feedback) {
      feedback.style.display = "block";
      feedback.innerHTML = `
        <div style="background:#fef2f2; border:1px solid #fca5a5; color:#991b1b; border-radius:10px; padding:12px 16px; font-size:0.82rem; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:1.2rem;">❌</span>
            <div>
              <div style="font-weight:800;">Backup Failed</div>
              <div style="font-size:0.75rem;">${msg}</div>
            </div>
          </div>
          <button type="button" onclick="this.parentElement.parentElement.style.display='none'" style="background:none; border:none; font-size:1.1rem; color:#991b1b; cursor:pointer;">×</button>
        </div>
      `;
    }
  }

  private renderList(rootElement?: HTMLElement) {
    const listEl = (rootElement || document).querySelector(`#${this.containerId}_list`);
    if (!listEl) return;

    if (this.backups.length === 0) {
      listEl.innerHTML = `
        <div style="padding:20px; text-align:center; color:#94a3b8; font-size:0.8rem;">
          No snapshots found in <code>data/backups/</code>. Click above to generate your first snapshot.
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.backups
      .map((b) => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid #f1f5f9; font-size:0.8rem;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:1rem; color:#059669;">📄</span>
            <div>
              <div style="font-weight:700; color:#1e293b; font-family:monospace; font-size:0.78rem;">${b.filename}</div>
              <div style="font-size:0.7rem; color:#64748b;">${new Date(b.createdAt).toLocaleString()} • ${b.sizeFormatted}</div>
            </div>
          </div>
          <div>
            <a href="/api/db/backups/${encodeURIComponent(b.filename)}" download="${b.filename}" style="display:inline-flex; align-items:center; gap:4px; padding:4px 10px; background:#f1f5f9; color:#0f172a; border-radius:6px; font-size:0.72rem; font-weight:700; text-decoration:none; border:1px solid #e2e8f0; transition:all 0.15s ease;" title="Download JSON Snapshot">
              ⬇ Download
            </a>
          </div>
        </div>
      `)
      .join("");
  }
}
