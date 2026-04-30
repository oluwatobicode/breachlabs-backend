import express, {
  type Application,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { API_CONFIG } from "./config/constants.config";
import { clerkMiddleware } from "@clerk/express";
import { env } from "./config/env";
import { errorMiddleware } from "./middleware/error.middleware";
import webhookRoutes from "./routes/webhook.routes";

import {
  adminRoutes,
  challengeRoutes,
  submissionRoutes,
  userRoutes,
} from "./routes";

const app: Application = express();

// webhooks registered before express.json() — svix needs the raw body
app.use("/webhooks", webhookRoutes);

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
app.use(express.json());
app.use(clerkMiddleware({ authorizedParties: allowedOrigins }));
app.use(express.urlencoded({ extended: true }));

// Test route
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Breach Lab API",
    version: API_CONFIG.VERSION,
    status: "running",
    docs: "/api-docs",
  });
});

app.get("/health", (req: Request, res: Response) =>
  res.status(200).json({
    status: "ok",
    requestId: req.ip,
  }),
);

app.use(`/api/${API_CONFIG.API_V1}/users`, userRoutes);
app.use(`/api/${API_CONFIG.API_V1}/admin`, adminRoutes);
app.use(`/api/${API_CONFIG.API_V1}/challenges`, challengeRoutes);
app.use(`/api/${API_CONFIG.API_V1}/submissions`, submissionRoutes);
app.use(errorMiddleware);

export default app;
