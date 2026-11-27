import express from "express";
import path from "path";
import fs from "fs";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import { apiRouter } from "./server/routes";
import { metricsEngine } from "./server/metrics";
import { syncManager } from "./server/sync";
import { dbEngine } from "./server/db";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

app.use(cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin", "X-Idempotency-Key"]
}));
app.options("*", cors());

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (!req.path.includes("/db/pulse") && !req.path.includes("/metrics")) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration
      }));
    }
  });
  next();
});

app.use("/api", apiRouter);

app.get("/api/health", (req, res) => {
  const uptimeSeconds = process.uptime();
  const records = dbEngine.getCollection("records") || [];
  const users = dbEngine.getCollection("users") || [];
  const payments = dbEngine.getCollection("payments") || [];

  res.json({
    status: "ok",
    version: "2.1.0",
    engine: "Hardened Durable Entity-Separated JSON Engine",
    uptime: Math.floor(uptimeSeconds),
    clientsConnected: syncManager.getActiveClientCount(),
    database: {
      status: "connected",
      recordsCount: records.length,
      usersCount: users.length,
      paymentsCount: payments.length,
      version: dbEngine.getVersion(),
      lastModified: dbEngine.getLastModified(),
      storageMode: "Atomic File Replacement + fsync + SHA-256 Checksums",
    },
    timestamp: new Date().toISOString(),
  });
});

function resolveSpaEntry(): string {
  const possiblePaths = [
    path.join(process.cwd(), "SiaraMainaInformatics.html"),
    path.join(process.cwd(), "index.html"),
    path.join(process.cwd(), "dist", "index.html"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(process.cwd(), "index.html");
}

app.get(["/", "/index.html", "/SiaraMainaInformatics.html"], (req, res) => {
  res.sendFile(resolveSpaEntry());
});

app.use(express.static(process.cwd()));
const distPath = path.join(process.cwd(), "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "API route not found" });
  }
  res.sendFile(resolveSpaEntry());
});

const server = app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`SiaraMaina Hardened Backend Engine running on http://0.0.0.0:${PORT} [${isProd ? "PROD" : "DEV"}]`);
});

const wss = new WebSocketServer({ server, path: "/api/sync/ws" });
wss.on("connection", (ws, req) => {
  syncManager.registerWebSocket(ws, req);
});

const shutdown = (signal: string) => {
  console.log(`[Server] Received ${signal}. Creating emergency backup snapshot...`);
  dbEngine.createBackupSnapshot();
  server.close(() => {
    console.log("[Server] Closed gracefully.");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
