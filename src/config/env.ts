import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1),
  AWS_REGION: z.string(),
  AWS_S3_BUCKET: z.string(),
  AWS_PROFILE: z.string().optional(),
  REDIS_URL: z.string().min(1),
  CLIENT_URL: z.string().url(),
  POLAR_ACCESS_TOKEN: z.string().min(1),
  POLAR_WEBHOOK_SECRET: z.string().min(1),
  POLAR_YEARLY_PRODUCT_ID: z.string().min(1),
  POLAR_MONTHLY_PRODUCT_ID: z.string().min(1),
  POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
  CHECKOUT_SUCCESS_URL: z.string().url(),
  DSN_SENTRY: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
