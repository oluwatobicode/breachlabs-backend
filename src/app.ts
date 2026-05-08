import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import { randomUUID } from "node:crypto";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { API_CONFIG } from "./config/constants.config";
import { clerkMiddleware } from "@clerk/express";
import { env } from "./config/env";
import { errorMiddleware } from "./middleware/error.middleware";
import webhookRoutes from "./routes/webhook.routes";
import { prisma } from "./config/db.config";
import { redis, ensureRedisConnection } from "./config/redis";

import {
  adminRoutes,
  challengeRoutes,
  leaderboardRoutes,
  submissionRoutes,
  subscriptionRoutes,
  userRoutes,
} from "./routes";
import * as Sentry from "@sentry/node";

const app: Application = express();
app.set("trust proxy", 1);

// webhooks registered before express.json() — svix needs the raw body
app.use(`/api/${API_CONFIG.API_V1}/webhooks`, webhookRoutes);

const allowedOrigins = Array.from(
  new Set([
    "http://localhost:5173",
    "https://breachlabs-app-frontend.vercel.app",
    env.CLIENT_URL,
  ]),
);

// midddlware
app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(morgan("dev"));
app.use(express.json({ limit: "64kb" }));
app.use(clerkMiddleware({ authorizedParties: allowedOrigins }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

// Test route
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Breach Lab API",
    version: API_CONFIG.VERSION,
    status: "running",
    docs: "/api-docs",
  });
});

app.get("/health", async (_req: Request, res: Response) => {
  const requestId = randomUUID();

  const [dbResult, redisResult] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    (async () => {
      await ensureRedisConnection();
      return redis.ping();
    })(),
  ]);

  const db = dbResult.status === "fulfilled" ? "ok" : "down";
  const cache = redisResult.status === "fulfilled" ? "ok" : "down";

  if (db === "down" && dbResult.status === "rejected") {
    console.error("Health check: DB ping failed", dbResult.reason);
  }
  if (cache === "down" && redisResult.status === "rejected") {
    console.error("Health check: Redis ping failed", redisResult.reason);
  }

  // DB is hard-required; Redis-only outage is "degraded" so the leaderboard
  // can fail open while the rest of the API keeps serving traffic.
  const status =
    db === "ok" && cache === "ok"
      ? "ok"
      : db === "ok"
        ? "degraded"
        : "down";

  const httpCode = db === "ok" ? 200 : 503;

  res.status(httpCode).json({
    status,
    requestId,
    checks: { db, cache },
  });
});

app.use(`/api/${API_CONFIG.API_V1}/users`, userRoutes);
app.use(`/api/${API_CONFIG.API_V1}/admin`, adminRoutes);
app.use(`/api/${API_CONFIG.API_V1}/challenges`, challengeRoutes);
app.use(`/api/${API_CONFIG.API_V1}/leaderboard`, leaderboardRoutes);
app.use(`/api/${API_CONFIG.API_V1}/submissions`, submissionRoutes);
app.use(`/api/${API_CONFIG.API_V1}/subscriptions`, subscriptionRoutes);
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

Sentry.setupExpressErrorHandler(app);
app.use(errorMiddleware);

export default app;
