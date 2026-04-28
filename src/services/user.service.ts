import { clerkClient } from "@clerk/express";
import { prisma } from "../config/db.config";
import { ApiError } from "../utils/ApiError";
import type { UpdateMeInput } from "../types/user.types";

export const updateUserProfile = async (
  userId: string,
  clerkId: string,
  data: UpdateMeInput
) => {
  if (data.username) {
    const taken = await prisma.user.findUnique({
      where: { username: data.username },
    });
    if (taken && taken.id !== userId) {
      throw new ApiError(409, "Username is already taken");
    }

    await clerkClient.users.updateUser(clerkId, { username: data.username });
  }

  return prisma.user.update({
    where: { id: userId },
    data,
  });
};

export const getPublicProfile = async (username: string) => {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      username: true,
      avatar: true,
      bio: true,
      createdAt: true,
    },
  });

  if (!user) throw new ApiError(404, "User not found");

  const rank = await getUserRank(username);

  return { ...user, rank };
};

const getUserRank = async (username: string): Promise<number> => {
  const userCompletions = await prisma.submission.findMany({
    where: { user: { username }, passed: true },
    select: { challengeId: true },
    distinct: ["challengeId"],
  });

  const userCount = userCompletions.length;

  const result = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count
    FROM (
      SELECT "userId"
      FROM "Submission"
      WHERE passed = true
      GROUP BY "userId"
      HAVING COUNT(DISTINCT "challengeId") > ${userCount}
    ) ahead
  `;

  return Number(result[0].count) + 1;
};
