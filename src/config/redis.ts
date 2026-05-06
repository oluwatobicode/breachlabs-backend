import Redis from "ioredis";
import { env } from "./env";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

redis.on("error", (error) => {
  console.error("Redis error:", error);
});

export const ensureRedisConnection = async () => {
  if (redis.status === "ready") return;

  if (redis.status === "connecting" || redis.status === "connect") {
    await new Promise<void>((resolve) => redis.once("ready", () => resolve()));
    return;
  }

  await redis.connect();
  console.log("Redis connected");
};
