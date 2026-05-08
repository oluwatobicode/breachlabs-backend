import { NextFunction, Request, Response } from "express";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { sendError, sendSuccess } from "../utils/ApiResponse";
import { DEFAULT_LIMIT, FILE_UPLOAD_CONFIG } from "../config/constants.config";
import { prisma } from "../config/db.config";
import { env } from "../config/env";
import {
  buildChallengeKey,
  getUploadUrl,
  deleteObject,
  s3,
} from "../services/s3.service";
import {
  Difficulty,
  Domain,
  Role,
  SubscriptionStatus,
} from "../generated/prisma/enums";
import { Prisma } from "../generated/prisma/client";
import {
  createChallengeSchema,
  updateChallengeSchema,
  createQuestionSchema,
  updateQuestionSchema,
  updateUserRoleSchema,
  updateUserSubscriptionSchema,
} from "../types/admin.types";
import { sanitizeSearchTerm } from "../utils/search.utils";
import {
  rebuildLeaderboardFromDatabase,
  recomputeUsersForChallenge,
} from "../services/redis.service";

export const rebuildLeaderboard = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await rebuildLeaderboardFromDatabase();
    return sendSuccess(res, "Leaderboard rebuilt", 200, result);
  } catch (error) {
    console.error(error);
    next(error);
  }
};

const ADMIN_USERS_MAX_LIMIT = 100;
const MAX_OFFSET = 10_000;

/* validates the request and returns a temporary, signed permission slip (presigned URL) */
export const uploadChallengeFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const { filename, contentType, sizeBytes } = req.body;

    if (!filename || typeof filename !== "string") {
      return sendError(res, 400, "filename is required");
    }

    if (!contentType || typeof contentType !== "string") {
      return sendError(res, 400, "contentType is required");
    }

    if (!FILE_UPLOAD_CONFIG.ALLOWED_MIME_TYPES.includes(contentType)) {
      return sendError(res, 400, "Only .zip files are allowed");
    }

    if (
      sizeBytes !== undefined &&
      typeof sizeBytes === "number" &&
      sizeBytes > FILE_UPLOAD_CONFIG.MAX_SIZE
    ) {
      return sendError(
        res,
        400,
        `File too large. Max size: ${FILE_UPLOAD_CONFIG.MAX_SIZE / 1024 / 1024}MB`,
      );
    }

    const challenge = await prisma.challenge.findUnique({ where: { id } });
    if (!challenge) {
      return sendError(res, 404, "Challenge not found");
    }

    const key = buildChallengeKey(id, filename);
    const uploadUrl = await getUploadUrl(key, contentType);

    return sendSuccess(res, "Upload URL generated", 200, {
      uploadUrl,
      key,
      expiresIn: 300,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

export const confirmChallengeFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;
    const { key } = req.body;

    if (!key || typeof key !== "string") {
      return sendError(res, 400, "key is required");
    }

    // Security check: key must belong to this challenge
    if (!/^[a-zA-Z0-9/._-]+$/.test(key)) {
      return sendError(res, 400, "Invalid key format");
    }

    if (key.includes("..") || key.includes("//")) {
      return sendError(res, 400, "Invalid key format");
    }

    // Security check: key must belong to this challenge
    const expectedPrefix = `challenges/${id}/`;
    if (!key.startsWith(expectedPrefix)) {
      return sendError(res, 400, "Invalid key for this challenge");
    }

    // Verify file actually exists in S3 (defense in depth)
    let head;
    try {
      head = await s3.send(
        new HeadObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key }),
      );
    } catch {
      return sendError(
        res,
        404,
        "File not found in S3 — upload may have failed",
      );
    }

    if (
      typeof head.ContentLength === "number" &&
      head.ContentLength > FILE_UPLOAD_CONFIG.MAX_SIZE
    ) {
      return sendError(
        res,
        400,
        `File too large. Max size: ${FILE_UPLOAD_CONFIG.MAX_SIZE / 1024 / 1024}MB`,
      );
    }

    if (
      !head.ContentType ||
      !FILE_UPLOAD_CONFIG.ALLOWED_MIME_TYPES.includes(head.ContentType)
    ) {
      return sendError(res, 400, "Only .zip files are allowed");
    }

    const existing = await prisma.challenge.findUnique({
      where: { id },
      select: { fileKey: true },
    });

    const updated = await prisma.challenge.update({
      where: { id },
      data: { fileKey: key },
    });

    if (existing?.fileKey && existing.fileKey !== key) {
      void deleteObject(existing.fileKey).catch((error) => {
        console.error("Failed to delete old file:", existing.fileKey, error);
      });
    }

    return sendSuccess(res, "File confirmed", 200, { challenge: updated });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

export const createChallenge = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const parsed = createChallengeSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, parsed.error.issues[0].message);
    }

    const {
      title,
      description,
      scenario,
      domain,
      difficulty,
      passScore,
      objectives,
      tools,
      isFree,
      points,
      questions,
    } = parsed.data;

    // Atomic create: challenge + nested questions in one transaction
    const challenge = await prisma.challenge.create({
      data: {
        title,
        description,
        scenario,
        objectives,
        tools,
        domain,
        difficulty,
        ...(passScore !== undefined && { passScore }),
        ...(typeof isFree === "boolean" && { isFree }),
        ...(typeof points === "number" && { points }),
        questions: {
          create: questions.map((q) => ({
            text: q.text,
            answerKey: q.answerKey,
            order: q.order,
          })),
        },
      },
      include: { questions: { orderBy: { order: "asc" } } },
    });

    return sendSuccess(res, "Challenge created", 201, { challenge });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

/* -------------------------------------------------------------------------- */
/*                              Update Challenge                              */
/* -------------------------------------------------------------------------- */

export const updateChallenge = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const parsed = updateChallengeSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, parsed.error.issues[0].message);
    }

    const existing = await prisma.challenge.findUnique({
      where: { id },
      select: { id: true, deletedAt: true, points: true },
    });

    if (!existing || existing.deletedAt) {
      return sendError(res, 404, "Challenge not found");
    }

    const updated = await prisma.challenge.update({
      where: { id },
      data: parsed.data as Prisma.ChallengeUpdateInput,
      include: { questions: { orderBy: { order: "asc" } } },
    });

    const pointsChanged =
      typeof parsed.data.points === "number" &&
      parsed.data.points !== existing.points;

    if (pointsChanged) {
      try {
        await recomputeUsersForChallenge(id);
      } catch (error) {
        console.error(
          "Failed to recompute leaderboard after challenge update:",
          error,
        );
      }
    }

    return sendSuccess(res, "Challenge updated", 200, { challenge: updated });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

/* Delete Challenge   */

export const deleteChallenge = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const challenge = await prisma.challenge.findUnique({
      where: { id },
      select: { id: true, fileKey: true, deletedAt: true },
    });

    if (!challenge || challenge.deletedAt) {
      return sendError(res, 404, "Challenge not found");
    }

    await prisma.challenge.update({
      where: { id },
      data: { deletedAt: new Date(), fileKey: null },
    });

    if (challenge.fileKey) {
      void deleteObject(challenge.fileKey).catch((error) => {
        console.error("Failed to delete S3 object:", challenge.fileKey, error);
      });
    }

    try {
      await recomputeUsersForChallenge(id);
    } catch (error) {
      console.error(
        "Failed to recompute leaderboard after challenge delete:",
        error,
      );
    }

    return sendSuccess(res, "Challenge deleted", 200);
  } catch (error) {
    console.error(error);
    next(error);
  }
};

/*  List Users  */

export const listUsers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const rawPage = req.query.page;
    const rawLimit = req.query.limit;
    const page = typeof rawPage === "string" ? Number(rawPage) : 1;
    const limit =
      typeof rawLimit === "string" ? Number(rawLimit) : DEFAULT_LIMIT;

    if (!Number.isInteger(page) || page < 1) {
      return sendError(res, 400, "page must be a positive integer");
    }
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > ADMIN_USERS_MAX_LIMIT
    ) {
      return sendError(
        res,
        400,
        `limit must be between 1 and ${ADMIN_USERS_MAX_LIMIT}`,
      );
    }

    const { search, role, subscriptionStatus } = req.query;
    const where: Prisma.UserWhereInput = {};

    if (typeof role === "string" && role !== "") {
      if (!Object.values(Role).includes(role as Role)) {
        return sendError(
          res,
          400,
          `role must be one of: ${Object.values(Role).join(", ")}`,
        );
      }
      where.role = role as Role;
    }

    if (typeof subscriptionStatus === "string" && subscriptionStatus !== "") {
      if (
        !Object.values(SubscriptionStatus).includes(
          subscriptionStatus as SubscriptionStatus,
        )
      ) {
        return sendError(
          res,
          400,
          `subscriptionStatus must be one of: ${Object.values(SubscriptionStatus).join(", ")}`,
        );
      }
      where.subscriptionStatus = subscriptionStatus as SubscriptionStatus;
    }

    if (typeof search === "string") {
      const sanitizedSearch = sanitizeSearchTerm(search);
      if (sanitizedSearch) {
        where.OR = [
          { username: { contains: sanitizedSearch, mode: "insensitive" } },
          { email: { contains: sanitizedSearch, mode: "insensitive" } },
        ];
      }
    }

    const skip = (page - 1) * limit;
    if (skip > MAX_OFFSET) {
      return sendError(res, 400, "Requested page is too large");
    }

    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          avatar: true,
          bio: true,
          role: true,
          subscriptionStatus: true,
          badges: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return sendSuccess(res, "Users fetched", 200, {
      users,
      page,
      limit,
      total,
      totalPages,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

/* Admin Stats   */

export const getAdminStats = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const [
      users,
      proUsers,
      challenges,
      submissions,
      passedSubmissions,
      recentSignups,
      recentSubmissions,
    ] = await prisma.$transaction([
      prisma.user.count(),
      prisma.user.count({
        where: { subscriptionStatus: SubscriptionStatus.PRO },
      }),
      prisma.challenge.count({ where: { deletedAt: null } }),
      prisma.submission.count(),
      prisma.submission.count({
        where: {
          passed: true,
          challenge: { deletedAt: null },
        },
      }),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          username: true,
          email: true,
          avatar: true,
          role: true,
          subscriptionStatus: true,
          createdAt: true,
        },
      }),
      prisma.submission.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          score: true,
          passed: true,
          attemptNumber: true,
          createdAt: true,
          user: {
            select: { id: true, username: true, avatar: true },
          },
          challenge: {
            select: { id: true, title: true },
          },
        },
      }),
    ]);

    return sendSuccess(res, "Stats fetched", 200, {
      totals: {
        users,
        proUsers,
        challenges,
        submissions,
        passedSubmissions,
      },
      recentSignups,
      recentSubmissions,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

/* -------------------------------------------------------------------------- */
/*                            Question Management                             */
/* -------------------------------------------------------------------------- */

export const createQuestion = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const challengeId = req.params.id as string;

    const parsed = createQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, parsed.error.issues[0].message);
    }

    const challenge = await prisma.challenge.findUnique({
      where: { id: challengeId },
      select: { id: true, deletedAt: true },
    });

    if (!challenge || challenge.deletedAt) {
      return sendError(res, 404, "Challenge not found");
    }

    try {
      const question = await prisma.question.create({
        data: { challengeId, ...parsed.data },
      });
      return sendSuccess(res, "Question created", 201, { question });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return sendError(
          res,
          409,
          "A question with that order already exists for this challenge",
        );
      }
      throw error;
    }
  } catch (error) {
    console.error(error);
    next(error);
  }
};

export const updateQuestion = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const challengeId = req.params.id as string;
    const questionId = req.params.questionId as string;

    const parsed = updateQuestionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, parsed.error.issues[0].message);
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, challengeId: true },
    });

    if (!question || question.challengeId !== challengeId) {
      return sendError(res, 404, "Question not found");
    }

    try {
      const updated = await prisma.question.update({
        where: { id: questionId },
        data: parsed.data,
      });
      return sendSuccess(res, "Question updated", 200, { question: updated });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return sendError(
          res,
          409,
          "A question with that order already exists for this challenge",
        );
      }
      throw error;
    }
  } catch (error) {
    console.error(error);
    next(error);
  }
};

export const deleteQuestion = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const challengeId = req.params.id as string;
    const questionId = req.params.questionId as string;

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, challengeId: true },
    });

    if (!question || question.challengeId !== challengeId) {
      return sendError(res, 404, "Question not found");
    }

    // A challenge with zero questions can't be graded — refuse the delete and
    // make the admin add a replacement first.
    const remaining = await prisma.question.count({ where: { challengeId } });
    if (remaining <= 1) {
      return sendError(
        res,
        400,
        "Cannot delete the last question — challenge must keep at least one",
      );
    }

    await prisma.question.delete({ where: { id: questionId } });
    return sendSuccess(res, "Question deleted", 200);
  } catch (error) {
    console.error(error);
    next(error);
  }
};

/* -------------------------------------------------------------------------- */
/*                       User Role / Subscription Admin                        */
/* -------------------------------------------------------------------------- */

export const updateUserRole = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.params.id as string;

    const parsed = updateUserRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, parsed.error.issues[0].message);
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!target) {
      return sendError(res, 404, "User not found");
    }

    // Refuse to demote the last remaining ADMIN — keeps the platform from
    // getting locked out of admin operations.
    if (target.role === Role.ADMIN && parsed.data.role !== Role.ADMIN) {
      const adminCount = await prisma.user.count({
        where: { role: Role.ADMIN },
      });
      if (adminCount <= 1) {
        return sendError(res, 400, "Cannot demote the last remaining admin");
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role: parsed.data.role as Role },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        subscriptionStatus: true,
      },
    });

    return sendSuccess(res, "User role updated", 200, { user: updated });
  } catch (error) {
    console.error(error);
    next(error);
  }
};

export const updateUserSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.params.id as string;

    const parsed = updateUserSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(res, 400, parsed.error.issues[0].message);
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!target) {
      return sendError(res, 404, "User not found");
    }

    const status = parsed.data.subscriptionStatus as SubscriptionStatus;

    // If admin didn't pass an end date, derive one: PRO gets +1 year so we
    // don't accidentally write a row that's already expired; FREE clears it.
    let subscriptionEndsAt: Date | null;
    if (parsed.data.subscriptionEndsAt === undefined) {
      if (status === SubscriptionStatus.PRO) {
        const oneYear = new Date();
        oneYear.setFullYear(oneYear.getFullYear() + 1);
        subscriptionEndsAt = oneYear;
      } else {
        subscriptionEndsAt = null;
      }
    } else {
      subscriptionEndsAt =
        parsed.data.subscriptionEndsAt === null
          ? null
          : new Date(parsed.data.subscriptionEndsAt);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus: status,
        subscriptionEndsAt,
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        subscriptionStatus: true,
        subscriptionEndsAt: true,
      },
    });

    return sendSuccess(res, "User subscription updated", 200, {
      user: updated,
    });
  } catch (error) {
    console.error(error);
    next(error);
  }
};
