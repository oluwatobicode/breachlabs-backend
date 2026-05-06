import { prisma } from "../config/db.config";
import { Prisma } from "../generated/prisma/client";
import { ClerkUserData } from "../types/ClerkUserData";
import {
  removeUserFromLeaderboard,
  updateLeaderboardDisplay,
} from "./redis.service";

const getPrimaryEmail = (data: ClerkUserData): string => {
  const primary =
    data.email_addresses.find(
      (e) => e.id === data.primary_email_address_id,
    ) ?? data.email_addresses[0];

  if (!primary) throw new Error("No email address on Clerk user");
  return primary.email_address;
};

const getProvider = (data: ClerkUserData): string => {
  const external = data.external_accounts[0]?.provider ?? "";
  if (external.includes("google")) return "google";
  return "email";
};

const getUsernameBase = (data: ClerkUserData, email: string) =>
  data.username ?? email.split("@")[0];

const isUsernameConflict = (error: unknown) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  return Array.isArray(target) && target.includes("username");
};

const createUserWithUniqueUsername = async (data: {
  clerkId: string;
  email: string;
  avatar: string;
  provider: string;
  baseUsername: string;
}) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const username =
      attempt === 0
        ? data.baseUsername
        : `${data.baseUsername}${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      return await prisma.user.create({
        data: {
          clerkId: data.clerkId,
          username,
          email: data.email,
          avatar: data.avatar,
          provider: data.provider,
        },
      });
    } catch (error) {
      if (isUsernameConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Failed to generate a unique username");
};

export const syncUserCreated = async (data: ClerkUserData) => {
  const email = getPrimaryEmail(data);
  const baseUsername = getUsernameBase(data, email);

  await createUserWithUniqueUsername({
    clerkId: data.id,
    email,
    avatar: data.image_url,
    provider: getProvider(data),
    baseUsername,
  });
};

export const syncUserUpdated = async (data: ClerkUserData) => {
  const email = getPrimaryEmail(data);

  const existingUser = await prisma.user.findUnique({
    where: { clerkId: data.id },
    select: { id: true },
  });

  if (existingUser) {
    const updatedUser = await prisma.user.update({
      where: { clerkId: data.id },
      data: {
        email,
        avatar: data.image_url,
      },
    });

    try {
      await updateLeaderboardDisplay(updatedUser.id, {
        username: updatedUser.username,
        avatar: updatedUser.avatar,
      });
    } catch (error) {
      console.error("Failed to sync leaderboard display after Clerk update:", error);
    }
    return;
  }

  const baseUsername = getUsernameBase(data, email);

  await createUserWithUniqueUsername({
    clerkId: data.id,
    email,
    avatar: data.image_url,
    provider: getProvider(data),
    baseUsername,
  });
};

export const syncUserDeleted = async (data: { id: string }) => {
  const existingUser = await prisma.user.findUnique({
    where: { clerkId: data.id },
    select: { id: true },
  });

  await prisma.user.deleteMany({
    where: { clerkId: data.id },
  });

  if (!existingUser) return;

  try {
    await removeUserFromLeaderboard(existingUser.id);
  } catch (error) {
    console.error("Failed to remove deleted user from leaderboard:", error);
  }
};
