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
  if (
    redis.status === "ready" ||
    redis.status === "connecting" ||
    redis.status === "connect"
  ) {
    return;
  }

  await redis.connect();
};
