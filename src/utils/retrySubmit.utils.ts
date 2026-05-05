import { FREE_ATTEMPT_LIMIT } from "../config/constants.config";
import { prisma } from "../config/db.config";
import { Prisma } from "../generated/prisma/client";
import { SubmittedAnswer } from "../types/submission.types";
import { ApiError } from "./ApiError";

export const createSubmissionWithRetry = async ({
  userId,
  challengeId,
  answers,
  reportUrl,
  score,
  passed,
  hasProAccess,
}: {
  userId: string;
  challengeId: string;
  answers: SubmittedAnswer[];
  reportUrl: string | null;
  score: number;
  passed: boolean;
  hasProAccess: boolean;
}) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const previousAttempts = await tx.submission.count({
            where: { userId, challengeId },
          });

          if (!hasProAccess && previousAttempts >= FREE_ATTEMPT_LIMIT) {
            throw new ApiError(
              403,
              `Free users limited to ${FREE_ATTEMPT_LIMIT} attempts per challenge. Upgrade to PRO for unlimited tries.`,
            );
          }

          return tx.submission.create({
            data: {
              userId,
              challengeId,
              answers: answers as unknown as Prisma.InputJsonValue,
              score,
              passed,
              attemptNumber: previousAttempts + 1,
              reportUrl,
            },
            select: {
              id: true,
              score: true,
              passed: true,
              attemptNumber: true,
              createdAt: true,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034") &&
        attempt < 2
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new ApiError(409, "Please retry this submission");
};
