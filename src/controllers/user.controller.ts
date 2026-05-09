import type { Request, Response, NextFunction } from "express";
import { updateUserProfile, getPublicProfile } from "../services/user.service";
import {
  getUserRankFromRedis,
  summarizeBestChallengeScores,
  updateLeaderboardDisplay,
} from "../services/redis.service";
import { sendSuccess } from "../utils/ApiResponse";
import type { UpdateMeInput } from "../types/user.types";
import { prisma } from "../config/db.config";
import { Domain } from "../generated/prisma/enums";
import { ApiError } from "../utils/ApiError";

export const getMe = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        username: true,
        email: true,
        avatar: true,
        bio: true,
        badges: true,
        role: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    sendSuccess(res, "Fetched user", 200, user);
  } catch (error) {
    next(error);
  }
};

export const updateMe = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const updated = await updateUserProfile(
      req.user!.id,
      req.user!.clerkId,
      req.body as UpdateMeInput,
    );

    try {
      await updateLeaderboardDisplay(updated.id, {
        username: updated.username,
        avatar: updated.avatar,
      });
    } catch (error) {
      console.error(
        "Failed to sync leaderboard display after profile update:",
        error,
      );
    }

    sendSuccess(res, "Profile updated", 200, updated);
  } catch (err) {
    next(err);
  }
};

export const getPublicUserProfile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const profile = await getPublicProfile(req.params.username as string);
    sendSuccess(res, "Fetched profile", 200, profile);
  } catch (err) {
    next(err);
  }
};

const RANK_BUCKETS: Array<{ maxPercentile: number; label: string }> = [
  { maxPercentile: 0.05, label: "Top 5%" },
  { maxPercentile: 0.1, label: "Top 10%" },
  { maxPercentile: 0.25, label: "Top 25%" },
  { maxPercentile: 0.5, label: "Top 50%" },
];

export const getMyStats = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user!.id;

    // (a) user's passed submissions, reduced to best score per challenge
    const passed = await prisma.submission.findMany({
      where: {
        userId,
        passed: true,
        challenge: { deletedAt: null },
      },
      select: { challengeId: true, score: true },
    });

    const { bestPerChallenge, points } = summarizeBestChallengeScores(passed);

    // (c) completed = distinct passed challenges
    const completed = bestPerChallenge.size;

    // (d) per-domain progress
    const completedChallengeIds = Array.from(bestPerChallenge.keys());
    const domains = Object.values(Domain);

    const totalPerDomain = await prisma.challenge.groupBy({
      by: ["domain"],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const totalMap = new Map(
      totalPerDomain.map((r) => [r.domain, r._count._all]),
    );

    const completedPerDomain = completedChallengeIds.length
      ? await prisma.challenge.groupBy({
          by: ["domain"],
          where: { id: { in: completedChallengeIds } },
          _count: { _all: true },
        })
      : [];
    const completedMap = new Map(
      completedPerDomain.map((r) => [r.domain, r._count._all]),
    );

    const domainProgress = domains.map((domain) => ({
      domain,
      completed: completedMap.get(domain) ?? 0,
      total: totalMap.get(domain) ?? 0,
    }));

    let rank: { rank: number | null; label: string };
    const { rank: redisRank, totalUsers } = await getUserRankFromRedis(userId);

    if (redisRank === null) {
      rank = { rank: null, label: "Unranked" };
    } else {
      if (redisRank <= 100) {
        rank = { rank: redisRank, label: `#${redisRank}` };
      } else {
        const percentile = totalUsers === 0 ? 1 : redisRank / totalUsers;
        const bucket = RANK_BUCKETS.find((b) => percentile <= b.maxPercentile);
        rank = { rank: null, label: bucket?.label ?? "Top 50%" };
      }
    }

    // (f) recent activity — last 10 submissions, passed or failed
    const recentActivity = await prisma.submission.findMany({
      where: { userId },
      select: {
        id: true,
        challengeId: true,
        score: true,
        passed: true,
        attemptNumber: true,
        createdAt: true,
        challenge: {
          select: { id: true, title: true, points: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return sendSuccess(res, "Fetched user stats", 200, {
      points,
      completed,
      rank,
      domainProgress,
      recentActivity,
    });
  } catch (err) {
    next(err);
  }
};
