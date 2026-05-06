import { prisma } from "../config/db.config";
import { redis } from "../config/redis";
import { rebuildLeaderboardFromDatabase } from "../services/redis.service";

const disconnect = async () => {
  await prisma.$disconnect();

  if (redis.status !== "end") {
    await redis.quit();
  }
};

async function main() {
  await prisma.$connect();

  const summary = await rebuildLeaderboardFromDatabase();
  console.log(
    `Leaderboard backfill complete. Processed ${summary.processedUsers} users and ranked ${summary.rankedUsers}.`,
  );
}

main()
  .catch((error) => {
    console.error("Leaderboard backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnect().catch((error) => {
      console.error("Failed to close leaderboard backfill resources:", error);
    });
  });
