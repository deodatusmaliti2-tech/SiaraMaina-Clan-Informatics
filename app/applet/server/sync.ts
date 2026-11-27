import { Response } from "express";
import { WebSocket } from "ws";

interface ConnectedSSEClient {
  id: string;
  res: Response;
  userAgent: string;
  ip: string;
  connectedAt: string;
  userEmail?: string;
}

interface ConnectedWSClient {
  id: string;
  ws: WebSocket;
  isAlive: boolean;
  connectedAt: string;
}

class RealtimeSyncManager {
  private sseClients: Map<string, ConnectedSSEClient> = new Map();
  private wsClients: Map<string, ConnectedWSClient> = new Map();

  constructor() {
    // 30-second heartbeat to monitor both SSE and WebSockets
    setInterval(() => {
      // WebSocket ping
      for (const [id, client] of this.wsClients.entries()) {
        if (!client.isAlive) {
          try { client.ws.terminate(); } catch {}
          this.wsClients.delete(id);
          continue;
        }
        client.isAlive = false;
        try {
          client.ws.ping();
        } catch {
          this.wsClients.delete(id);
        }
      }

      // SSE ping
      this.broadcast("ping", {
        timestamp: new Date().toISOString(),
        activeNodes: this.getActiveClientCount(),
      });
    }, 30000);
  }

  // SSE Registration
  public registerClient(
    id: string,
    res: Response,
    userAgent: string = "",
    ip: string = "",
    userEmail?: string
  ) {
    this.sseClients.set(id, {
      id,
      res,
      userAgent,
      ip,
      connectedAt: new Date().toISOString(),
      userEmail,
    });

    try {
      res.write(
        `event: handshake\ndata: ${JSON.stringify({
          clientId: id,
          status: "CONNECTED",
          activeNodes: this.getActiveClientCount(),
          timestamp: new Date().toISOString(),
        })}\n\n`
      );
    } catch {}
  }

  public removeClient(id: string) {
    this.sseClients.delete(id);
  }

  // WebSocket Registration
  public registerWebSocket(ws: WebSocket, req: any) {
    const id = "ws-" + Math.random().toString(36).substring(2, 10);
    const client: ConnectedWSClient = {
      id,
      ws,
      isAlive: true,
      connectedAt: new Date().toISOString(),
    };

    this.wsClients.set(id, client);

    ws.on("pong", () => {
      client.isAlive = true;
    });

    ws.on("close", () => {
      this.wsClients.delete(id);
    });

    ws.on("error", () => {
      this.wsClients.delete(id);
    });

    // Immediate Handshake with connection count
    try {
      ws.send(JSON.stringify({
        event: "handshake",
        clientId: id,
        status: "CONNECTED",
        activeNodes: this.getActiveClientCount(),
        timestamp: new Date().toISOString(),
      }));
    } catch {}
  }

  // Unified immediate broadcast to both WebSockets and SSE
  public broadcast(event: string, payload: any) {
    const sseData = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    const wsData = JSON.stringify({ event, payload });

    // 1. Broadcast to SSE Clients
    for (const [clientId, client] of this.sseClients.entries()) {
      try {
        client.res.write(sseData);
      } catch {
        this.sseClients.delete(clientId);
      }
    }

    // 2. Broadcast to WebSocket Clients immediately
    for (const [clientId, client] of this.wsClients.entries()) {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(wsData);
        }
      } catch {
        this.wsClients.delete(clientId);
      }
    }
  }

  public getActiveClientCount(): number {
    return this.sseClients.size + this.wsClients.size;
  }
}

export const syncManager = new RealtimeSyncManager();
