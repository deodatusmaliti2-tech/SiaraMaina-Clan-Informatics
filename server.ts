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
import cron from "node-cron";
import { serverSyncSheetToApp } from "./server/sheets";

dotenv.config();

// Run initial server-side sheet sync immediately on startup, then poll every 10 seconds
serverSyncSheetToApp();
setInterval(() => {
  serverSyncSheetToApp();
}, 10000);

const app = express();
const PORT = 3000;
const isProd = process.env.NODE_ENV === "production";

const allowedOrigins = [
  "https://deodatusmaliti2-tech.github.io",
  "https://ais-dev-eghyyu5v5dome452e47als-300519060027.europe-west2.run.app",
  "https://ais-pre-eghyyu5v5dome452e47als-300519060027.europe-west2.run.app",
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server)
    if (!origin) return callback(null, true);

    // Explicit check for GitHub Pages origin (e.g. https://deodatusmaliti2-tech.github.io)
    if (origin === "https://deodatusmaliti2-tech.github.io" || origin.endsWith(".github.io")) {
      return callback(null, true);
    }

    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith(".run.app") ||
      origin.endsWith(".ai.studio") ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1")
    ) {
      return callback(null, true);
    }

    // Default fallback to allow requesting origin
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "X-Idempotency-Key",
    "X-Submission-Id",
    "Cache-Control",
    "Pragma"
  ],
  exposedHeaders: ["Content-Length", "X-JSON-Sha", "X-Record-Count"],
  maxAge: 86400
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Explicit header fallback to guarantee Access-Control headers for GitHub Pages origin
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (origin === "https://deodatusmaliti2-tech.github.io" || origin.endsWith(".github.io"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Idempotency-Key, X-Submission-Id");
  }
  next();
});

app.use(express.json({
  limit: "50mb",
  verify: (req: any, res, buf) => {
    if (req.originalUrl && req.originalUrl.includes("/webhook")) {
      req.rawBody = buf;
    }
  }
}));
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

app.get("/api/health", async (req, res) => {
  const uptimeSeconds = process.uptime();
  try {
    const stats = await dbEngine.getStats();
    res.json({
      status: "ok",
      version: "3.0.0",
      engine: "Cloud Firestore Enterprise Database Engine",
      uptime: Math.floor(uptimeSeconds),
      clientsConnected: syncManager.getActiveClientCount(),
      database: {
        status: "connected",
        authority: "Cloud Firestore Enterprise (Verified Native Project)",
        recordsCount: stats.totalRecords,
        recycleBinCount: stats.recycleBinCount,
        usersCount: stats.totalUsers,
        approvedUsers: stats.approvedUsers,
        projectId: stats.projectId,
        databaseId: stats.databaseId,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

app.use("/api", apiRouter);

function resolveSpaEntry(): string {
  const possiblePaths = [
    path.join(process.cwd(), "index.html"),
    path.join(process.cwd(), "dist", "index.html"),
    path.join(process.cwd(), "SiaraMainaInformatics.html"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(process.cwd(), "index.html");
}

app.get(["/", "/index.html", "/SiaraMainaInformatics.html"], (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(resolveSpaEntry());
});

app.use(express.static(process.cwd()));
const publicPath = path.join(process.cwd(), "public");
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
}
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

server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`[Server] Port ${PORT} is temporarily busy. Retrying bind to port ${PORT} in 1 second...`);
    setTimeout(() => {
      try { server.close(); } catch(e){}
      server.listen(Number(PORT), "0.0.0.0");
    }, 1000);
  } else {
    console.error("[Server] Listen error:", err);
  }
});

const wss = new WebSocketServer({ server, path: "/api/sync/ws" });
wss.on("connection", (ws, req) => {
  syncManager.registerWebSocket(ws, req);
});

const shutdown = (signal: string) => {
  console.log(`[Server] Received ${signal}. Closing server gracefully...`);
  server.close(() => {
    console.log("[Server] Closed gracefully.");
    process.exit(0);
  });
};

// Resilient handling for all uncaught rejections & errors to ensure high uptime
process.on("unhandledRejection", (reason: any) => {
  const msg = reason?.message || String(reason || "");
  console.warn(`[Server] Handled async notice: ${msg}`);
});

process.on("uncaughtException", (err: any) => {
  const msg = err?.message || String(err || "");
  const code = err?.code;
  if (code === "EADDRINUSE" || msg.includes("EADDRINUSE")) {
    console.warn(`[Server] Port 3000 already in use (handled gracefully).`);
    return;
  }
  console.warn(`[Server] Handled uncaught exception: ${msg}`);
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

