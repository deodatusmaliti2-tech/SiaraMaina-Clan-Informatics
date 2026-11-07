import { BackendApiService } from "../services/backendApi";

export interface SyncStatusIndicatorOptions {
  containerId?: string;
  className?: string;
}

/**
 * Status indicator component that uses backendApi.subscribe to listen for 'ping' events
 * and displays the current number of active sync nodes to the user.
 */
export class SyncStatusIndicator {
  private container: HTMLElement | null = null;
  private nodesCountEl: HTMLElement | null = null;
  private dotEl: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private activeNodes: number = 1;

  constructor(
    private backendApi: BackendApiService,
    private options: SyncStatusIndicatorOptions = {}
  ) {
    if (options.containerId) {
      this.mount(options.containerId);
    }
  }

  public mount(target?: HTMLElement | string) {
    let parent: HTMLElement | null = null;
    if (typeof target === "string") {
      parent = document.getElementById(target);
    } else if (target instanceof HTMLElement) {
      parent = target;
    } else if (this.options.containerId) {
      parent = document.getElementById(this.options.containerId);
    }

    if (!parent) return;

    // Check if already mounted
    const existing = parent.querySelector("#syncNodesIndicator");
    if (existing) {
      this.container = existing as HTMLElement;
      this.dotEl = this.container.querySelector(".sync-pulse-dot");
      this.nodesCountEl = this.container.querySelector(".sync-nodes-count");
    } else {
      this.container = document.createElement("div");
      this.container.id = "syncNodesIndicator";
      this.container.className = this.options.className || "sync-nodes-indicator";
      this.container.style.cssText =
        "display:inline-flex; align-items:center; gap:6px; background:#e8f4ec; color:#103d2b; border:1px solid #c2dec9; border-radius:20px; padding:4px 10px; font-size:0.72rem; font-weight:700; cursor:pointer; transition:all 0.25s ease;";
      this.container.title = "Connected to in-built real-time SSE sync engine";

      this.container.innerHTML = `
        <span class="sync-pulse-dot" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981; box-shadow:0 0 6px #10b981; transition:all 0.3s ease;"></span>
        <span class="sync-nodes-label">Sync Nodes: <span class="sync-nodes-count">${this.activeNodes}</span></span>
      `;

      this.dotEl = this.container.querySelector(".sync-pulse-dot");
      this.nodesCountEl = this.container.querySelector(".sync-nodes-count");

      parent.appendChild(this.container);
    }

    // Subscribe to SSE events from the backendApi
    this.unsubscribe = this.backendApi.subscribe((event: string, data: any) => {
      if (event === "ping") {
        if (data && typeof data.activeNodes === "number") {
          this.setActiveNodes(data.activeNodes);
        }
        this.flashHeartbeat();
      } else if (event === "handshake") {
        if (data && typeof data.activeNodes === "number") {
          this.setActiveNodes(data.activeNodes);
        }
      }
    });
  }

  public setActiveNodes(count: number) {
    this.activeNodes = count;
    if (this.nodesCountEl) {
      this.nodesCountEl.textContent = String(count);
    }
    if (this.container) {
      this.container.title = `SSE Sync Active: ${count} node${count === 1 ? "" : "s"} connected in real-time`;
    }
  }

  public flashHeartbeat() {
    if (!this.dotEl) return;
    this.dotEl.style.transform = "scale(1.4)";
    this.dotEl.style.boxShadow = "0 0 10px #22c55e";
    setTimeout(() => {
      if (this.dotEl) {
        this.dotEl.style.transform = "scale(1)";
        this.dotEl.style.boxShadow = "0 0 6px #10b981";
      }
    }, 400);
  }

  public destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
