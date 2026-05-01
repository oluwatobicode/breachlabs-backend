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
import { updateChallengeSchema } from "../types/admin.types";

const ADMIN_USERS_MAX_LIMIT = 100;

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

    // Security check: key must belong to this challenge
    const expectedPrefix = `challenges/${id}/`;
    if (!key.startsWith(expectedPrefix)) {
      return sendError(res, 400, "Invalid key for this challenge");
    }

    // Verify file actually exists in S3 (defense in depth)
    try {
      await s3.send(
        new HeadObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key }),
      );
    } catch {
      return sendError(
        res,
        404,
        "File not found in S3 — upload may have failed",
      );
    }

    // If challenge already had a file, delete the old one
    const existing = await prisma.challenge.findUnique({
      where: { id },
      select: { fileKey: true },
    });
    if (existing?.fileKey && existing.fileKey !== key) {
      try {
        await deleteObject(existing.fileKey);
      } catch (error) {
        // Don't fail the request — log and continue (new file is what matters)
        console.error("Failed to delete old file:", existing.fileKey, error);
      }
    }

    const updated = await prisma.challenge.update({
      where: { id },
      data: { fileKey: key },
    });

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
    } = req.body;

    // Validate required fields
    if (!title || typeof title !== "string") {
      return sendError(res, 400, "title is required");
    }
    if (!description || typeof description !== "string") {
      return sendError(res, 400, "description is required");
    }
    if (!scenario || typeof scenario !== "string") {
      return sendError(res, 400, "scenario is required");
    }

    // Validate enums against Prisma values (no garbage strings)
    if (!Object.values(Domain).includes(domain)) {
      return sendError(
        res,
        400,
        `domain must be one of: ${Object.values(Domain).join(", ")}`,
      );
    }
    if (!Object.values(Difficulty).includes(difficulty)) {
      return sendError(
        res,
        400,
        `difficulty must be one of: ${Object.values(Difficulty).join(", ")}`,
      );
    }

    if (
      passScore !== undefined &&
      (!Number.isInteger(passScore) || passScore < 1 || passScore > 100)
    ) {
      return sendError(
        res,
        400,
        "passScore must be an integer between 1 and 100",
      );
    }

    // Validate questions
    if (!Array.isArray(questions) || questions.length === 0) {
      return sendError(res, 400, "questions array is required (at least one)");
    }

    for (const [i, q] of questions.entries()) {
      if (!q.text || typeof q.text !== "string") {
        return sendError(res, 400, `questions[${i}].text is required`);
      }
      if (!q.answerKey || typeof q.answerKey !== "string") {
        return sendError(res, 400, `questions[${i}].answerKey is required`);
      }
      if (typeof q.order !== "number") {
        return sendError(res, 400, `questions[${i}].order must be a number`);
      }
    }

    // Check for duplicate orders within the submitted questions
    const orders = questions.map((q: any) => q.order);
    if (new Set(orders).size !== orders.length) {
      return sendError(res, 400, "questions must have unique order values");
    }

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
          create: questions.map((q: any) => ({
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
      select: { id: true, deletedAt: true },
    });

    if (!existing || existing.deletedAt) {
      return sendError(res, 404, "Challenge not found");
    }

    const updated = await prisma.challenge.update({
      where: { id },
      data: parsed.data as Prisma.ChallengeUpdateInput,
      include: { questions: { orderBy: { order: "asc" } } },
    });

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

    if (challenge.fileKey) {
      try {
        await deleteObject(challenge.fileKey);
      } catch (error) {
        // Log and continue — DB soft-delete is the source of truth.
        console.error("Failed to delete S3 object:", challenge.fileKey, error);
      }
    }

    await prisma.challenge.update({
      where: { id },
      data: { deletedAt: new Date(), fileKey: null },
    });

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

    if (typeof search === "string" && search.trim()) {
      where.OR = [
        { username: { contains: search.trim(), mode: "insensitive" } },
        { email: { contains: search.trim(), mode: "insensitive" } },
      ];
    }

    const skip = (page - 1) * limit;

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
