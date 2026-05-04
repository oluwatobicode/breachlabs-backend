import { NextFunction, Request, Response } from "express";
import { sendError } from "../utils/ApiResponse";
import { prisma } from "../config/db.config";
import { getDownloadUrl } from "../services/s3.service";
import {
  Domain,
  Difficulty,
  SubscriptionStatus,
} from "../generated/prisma/enums";
import { Prisma } from "../generated/prisma/client";

const SORT_MAP = {
  newest: { createdAt: "desc" as const },
  oldest: { createdAt: "asc" as const },
  "points-asc": { points: "asc" as const },
  "points-desc": { points: "desc" as const },
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Page-based pagination: users browse a filtered catalog and may jump to page N directly.
// Cursor-based would be better for infinite-scroll feeds; offset is the right call for a
// filterable explore page where total count and page numbers are useful to the UI.
export const listChallenges = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // --- Pagination ---
    const rawPage = req.query.page;
    const rawLimit = req.query.limit;
    const page = typeof rawPage === "string" ? Number(rawPage) : 1;
    const limit =
      typeof rawLimit === "string" ? Number(rawLimit) : DEFAULT_LIMIT;

    if (!Number.isInteger(page) || page < 1) {
      return sendError(res, 400, "page must be a positive integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return sendError(res, 400, `limit must be between 1 and ${MAX_LIMIT}`);
    }

    // --- Sort ---
    const sortKey =
      typeof req.query.sort === "string" ? req.query.sort : "newest";
    if (!(sortKey in SORT_MAP)) {
      return sendError(
        res,
        400,
        `sort must be one of: ${Object.keys(SORT_MAP).join(", ")}`,
      );
    }
    const orderBy = SORT_MAP[sortKey as keyof typeof SORT_MAP];

    // --- Filters ---
    const { domain, difficulty, isFree, search } = req.query;
    const where: Prisma.ChallengeWhereInput = { deletedAt: null };

    if (domain && typeof domain === "string") {
      if (!Object.values(Domain).includes(domain as Domain)) {
        return sendError(
          res,
          400,
          `domain must be one of: ${Object.values(Domain).join(", ")}`,
        );
      }
      where.domain = domain as Domain;
    }

    if (difficulty && typeof difficulty === "string") {
      if (!Object.values(Difficulty).includes(difficulty as Difficulty)) {
        return sendError(
          res,
          400,
          `difficulty must be one of: ${Object.values(Difficulty).join(", ")}`,
        );
      }
      where.difficulty = difficulty as Difficulty;
    }

    if (typeof isFree === "string" && isFree !== "") {
      if (isFree !== "true" && isFree !== "false") {
        return sendError(res, 400, "isFree must be 'true' or 'false'");
      }
      where.isFree = isFree === "true";
    }

    if (search && typeof search === "string" && search.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: "insensitive" } },
        { description: { contains: search.trim(), mode: "insensitive" } },
      ];
    }

    const skip = (page - 1) * limit;

    const [challenges, total] = await prisma.$transaction([
      prisma.challenge.findMany({
        select: {
          id: true,
          title: true,
          description: true,
          domain: true,
          difficulty: true,
          isFree: true,
          points: true,
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.challenge.count({ where }),
    ]);

    const completedRows = req.user
      ? await prisma.submission.findMany({
          where: {
            userId: req.user.id,
            passed: true,
            challengeId: { in: challenges.map((c) => c.id) },
          },
          select: { challengeId: true },
          distinct: ["challengeId"],
        })
      : [];
    const completedSet = new Set(completedRows.map((r) => r.challengeId));

    const challengesWithCompletion = challenges.map((c) => ({
      ...c,
      completed: completedSet.has(c.id),
    }));

    const totalPages = Math.ceil(total / limit);

    return res.json({
      challenges: challengesWithCompletion,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

export const getChallengeById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const challenge = await prisma.challenge.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        scenario: true,
        domain: true,
        difficulty: true,
        passScore: true,
        objectives: true,
        tools: true,
        isFree: true,
        points: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        questions: {
          select: { id: true, text: true, order: true },
          orderBy: { order: "asc" },
        },
      },
    });

    if (!challenge || challenge.deletedAt) {
      return sendError(res, 404, "Challenge not found");
    }

    if (
      !challenge.isFree &&
      req.user?.subscriptionStatus !== SubscriptionStatus.PRO
    ) {
      return sendError(res, 403, "This challenge requires a PRO subscription");
    }

    const { deletedAt, ...rest } = challenge;
    return res.json({ challenge: rest });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

export const downloadChallengeFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    const challenge = await prisma.challenge.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        title: true,
        fileKey: true,
        isFree: true,
      },
    });

    if (!challenge) {
      return sendError(res, 404, "Challenge not found");
    }

    if (!challenge.fileKey) {
      return sendError(res, 404, "Challenge has no file uploaded yet");
    }

    // Access check: paid challenges require PRO subscription
    if (!challenge.isFree) {
      // req.user is set by requireAuth middleware
      if (req.user!.subscriptionStatus !== SubscriptionStatus.PRO) {
        return sendError(
          res,
          403,
          "This challenge requires a PRO subscription",
        );
      }
    }

    // Build a friendly download filename
    const safeTitle = challenge.title.replace(/[^a-zA-Z0-9._-]/g, "_");
    const downloadFilename = `${safeTitle}.zip`;

    const downloadUrl = await getDownloadUrl(
      challenge.fileKey,
      downloadFilename,
    );

    return res.json({
      downloadUrl,
      expiresIn: 600,
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};
