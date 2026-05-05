import { clerkClient } from "@clerk/express";
import { prisma } from "../config/db.config";
import { ApiError } from "../utils/ApiError";
import type { UpdateMeInput } from "../types/user.types";
import { Prisma } from "../generated/prisma/client";

export const updateUserProfile = async (
  userId: string,
  clerkId: string,
  data: UpdateMeInput,
) => {
  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
    });

    if (data.username) {
      await clerkClient.users.updateUser(clerkId, { username: data.username });
    }

    return updated;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ApiError(409, "Username is already taken");
    }

    throw error;
  }
};

export const getPublicProfile = async (username: string) => {
  const user = await prisma.user.findFirst({
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      username: true,
      avatar: true,
      bio: true,
      createdAt: true,
    },
  });

  if (!user) throw new ApiError(404, "User not found");

  const rank = await getUserRank(user.id);

  const { id, ...profile } = user;
  return { ...profile, rank };
};

const getUserRank = async (userId: string): Promise<number> => {
  const userCompletions = await prisma.submission.findMany({
    where: { userId, passed: true },
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
