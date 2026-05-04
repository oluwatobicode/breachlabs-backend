import "dotenv/config";
import * as Sentry from "@sentry/node";
import { env } from "./config/env";

Sentry.init({
  dsn: env.DSN_SENTRY,
  environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
  tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
});
