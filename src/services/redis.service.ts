import {
  LEADERBOARD_KEY,
  LEADERBOARD_USER_KEY_PREFIX,
} from "../config/constants.config";
import { prisma } from "../config/db.config";
import { ensureRedisConnection, redis } from "../config/redis";

export const recomputeUsersForChallenge = async (challengeId: string) => {
  // Find every user with at least one passed submission for this challenge —
  // these are the only users whose totals can shift when a challenge's points
  // change or it gets soft-deleted.
  const rows = await prisma.submission.findMany({
    where: { challengeId, passed: true },
    select: {
      userId: true,
      user: { select: { id: true, username: true, avatar: true } },
    },
    distinct: ["userId"],
  });

  let updated = 0;
  for (const row of rows) {
    const points = await recomputeUserPoints(row.userId);
    if (points <= 0) {
      await removeUserFromLeaderboard(row.userId);
    } else {
      await syncUserToLeaderboard(row.userId, points, {
        username: row.user.username,
        avatar: row.user.avatar,
      });
    }
    updated += 1;
  }

  return { affectedUsers: updated };
};

export const isLeaderboardEmpty = async () => {
  await ensureRedisConnection();
  return (await redis.zcard(LEADERBOARD_KEY)) === 0;
};

export const ensureLeaderboardPopulated = async () => {
  if (!(await isLeaderboardEmpty())) {
    return { rebuilt: false as const };
  }

  // Empty ZSET on boot likely means Redis was restarted without persistence
  // (no AOF/RDB) — rebuild from Postgres so the leaderboard isn't wiped.
  const passedExists = await prisma.submission.findFirst({
    where: { passed: true, challenge: { deletedAt: null } },
    select: { id: true },
  });

  if (!passedExists) {
    return { rebuilt: false as const };
  }

  console.log(
    "Leaderboard ZSET empty but passed submissions exist — rebuilding from DB",
  );
  const result = await rebuildLeaderboardFromDatabase();
  return { rebuilt: true as const, ...result };
};

type ChallengeScoreRow = {
  challengeId: string;
  score: number;
};

type LeaderboardDisplay = {
  username: string;
  avatar: string | null;
};

const getLeaderboardUserKey = (userId: string) =>
  `${LEADERBOARD_USER_KEY_PREFIX}${userId}`;

export const summarizeBestChallengeScores = (submissions: ChallengeScoreRow[]) => {
  const bestPerChallenge = new Map<string, number>();
  for (const submission of submissions) {
    const previousBest = bestPerChallenge.get(submission.challengeId);
    if (previousBest === undefined || submission.score > previousBest) {
      bestPerChallenge.set(submission.challengeId, submission.score);
    }
  }

  const points = Array.from(bestPerChallenge.values()).reduce(
    (total, score) => total + score,
    0,
  );

  return { bestPerChallenge, points };
};

export const recomputeUserPoints = async (userId: string) => {
  const passed = await prisma.submission.findMany({
    where: {
      userId,
      passed: true,
      challenge: { deletedAt: null },
    },
    select: { challengeId: true, score: true },
  });

  return summarizeBestChallengeScores(passed).points;
};

export const syncUserToLeaderboard = async (
  userId: string,
  points: number,
  display: LeaderboardDisplay,
) => {
  await ensureRedisConnection();
  await redis
    .pipeline()
    .zadd(LEADERBOARD_KEY, points, userId)
    .hset(getLeaderboardUserKey(userId), {
      username: display.username,
      avatar: display.avatar ?? "",
    })
    .exec();
};

export const updateLeaderboardDisplay = async (
  userId: string,
  display: LeaderboardDisplay,
) => {
  await ensureRedisConnection();
  // Skip if user isn't on the leaderboard yet — avoids orphan hashes for users
  // who update their profile before completing any challenge.
  const score = await redis.zscore(LEADERBOARD_KEY, userId);
  if (score === null) return;

  await redis.hset(getLeaderboardUserKey(userId), {
    username: display.username,
    avatar: display.avatar ?? "",
  });
};

export const removeUserFromLeaderboard = async (userId: string) => {
  await ensureRedisConnection();
  await redis
    .pipeline()
    .zrem(LEADERBOARD_KEY, userId)
    .del(getLeaderboardUserKey(userId))
    .exec();
};

const deleteKeysByPattern = async (pattern: string) => {
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      200,
    );

    if (keys.length > 0) {
      await redis.del(...keys);
    }

    cursor = nextCursor;
  } while (cursor !== "0");
};

export const clearLeaderboard = async () => {
  await ensureRedisConnection();

  await redis.del(LEADERBOARD_KEY);
  await deleteKeysByPattern(`${LEADERBOARD_USER_KEY_PREFIX}*`);
};

export const rebuildLeaderboardFromDatabase = async () => {
  await clearLeaderboard();

  const users = await prisma.user.findMany({
    where: {
      submissions: {
        some: {
          passed: true,
          challenge: { deletedAt: null },
        },
      },
    },
    select: {
      id: true,
      username: true,
      avatar: true,
    },
  });

  let rankedUsers = 0;
  for (const user of users) {
    const points = await recomputeUserPoints(user.id);
    if (points <= 0) continue;

    await syncUserToLeaderboard(user.id, points, {
      username: user.username,
      avatar: user.avatar,
    });
    rankedUsers += 1;
  }

  return {
    processedUsers: users.length,
    rankedUsers,
  };
};

export const getLeaderboardPage = async (start: number, stop: number) => {
  await ensureRedisConnection();
  const [raw, total] = await Promise.all([
    redis.zrevrange(LEADERBOARD_KEY, start, stop, "WITHSCORES"),
    redis.zcard(LEADERBOARD_KEY),
  ]);

  const entries: { userId: string; points: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({ userId: raw[i], points: Number(raw[i + 1]) });
  }

  if (entries.length === 0) {
    return { entries: [], total };
  }

  const pipeline = redis.pipeline();
  for (const e of entries) pipeline.hgetall(getLeaderboardUserKey(e.userId));
  const results = await pipeline.exec();

  const rows = entries.map((e, i) => {
    const display = (results?.[i]?.[1] as Record<string, string>) ?? {};
    return {
      rank: start + i + 1,
      userId: e.userId,
      points: e.points,
      username: display.username ?? "Unknown",
      avatar: display.avatar || null,
    };
  });

  return { entries: rows, total };
};

export const getUserRankFromRedis = async (userId: string) => {
  await ensureRedisConnection();

  const [rankZeroIndexed, points, totalUsers] = await Promise.all([
    redis.zrevrank(LEADERBOARD_KEY, userId),
    redis.zscore(LEADERBOARD_KEY, userId),
    redis.zcard(LEADERBOARD_KEY),
  ]);

  return {
    rank: rankZeroIndexed === null ? null : rankZeroIndexed + 1,
    points: points === null ? 0 : Number(points),
    totalUsers,
  };
};
