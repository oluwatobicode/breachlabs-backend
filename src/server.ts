import "./instrument";

import { prisma } from "./config/db.config";
import app from "./app";
import { ensureRedisConnection } from "./config/redis";
import { ensureLeaderboardPopulated } from "./services/redis.service";

const PORT = process.env.PORT || 5000;

async function main() {
  await prisma.$connect();
  console.log("Connected to the database");

  const server = app.listen(PORT, async () => {
    await ensureRedisConnection();
    try {
      const result = await ensureLeaderboardPopulated();
      if (result.rebuilt) {
        console.log(
          `Leaderboard auto-rebuilt: processed=${result.processedUsers} ranked=${result.rankedUsers}`,
        );
      }
    } catch (error) {
      console.error("Leaderboard auto-rebuild failed:", error);
    }
    console.log(`Server is running on port ${PORT}`);
  });

  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received. Shutting down gracefully...`);

    server.close(() => {
      prisma
        .$disconnect()
        .then(() => process.exit(0))
        .catch((error) => {
          console.error("Failed to disconnect Prisma:", error);
          process.exit(1);
        });
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
