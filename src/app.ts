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
import { errorMiddleware } from "./middleware/error.middleware";
import webhookRoutes from "./routes/webhook.routes";
import { env } from "./config/env";
import { adminRoutes, challengeRoutes, userRoutes } from "./routes";

const app: Application = express();

// webhooks registered before express.json() — svix needs the raw body
app.use("/webhooks", webhookRoutes);

// midddlware
app.use(helmet());
// app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(morgan("dev"));
app.use(express.json());
app.use(clerkMiddleware());
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
app.use(errorMiddleware);

export default app;
