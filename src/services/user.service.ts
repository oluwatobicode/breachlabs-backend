import { clerkClient } from "@clerk/express";
import { prisma } from "../config/db.config";
import { ApiError } from "../utils/ApiError";
import type { UpdateMeInput } from "../types/user.types";
import { Prisma } from "../generated/prisma/client";
import { getUserRankFromRedis } from "./redis.service";

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

  const { rank, points } = await getUserRankFromRedis(user.id);

  const { id, ...profile } = user;
  return { ...profile, rank, points };
};
