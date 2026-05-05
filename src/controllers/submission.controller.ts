import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/db.config";
import { sendError, sendSuccess } from "../utils/ApiResponse";
import { Prisma } from "../generated/prisma/client";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../config/constants.config";
import { buildSubmissionReview } from "../utils/submission.utils";

const MAX_OFFSET = 10_000;

/*   List My Submissions  */

export const listMySubmissions = async (
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

    // --- Filters ---
    const where: Prisma.SubmissionWhereInput = { userId: req.user!.id };

    const { challengeId, passed } = req.query;

    if (typeof challengeId === "string" && challengeId !== "") {
      where.challengeId = challengeId;
    }

    if (typeof passed === "string" && passed !== "") {
      if (passed !== "true" && passed !== "false") {
        return sendError(res, 400, "passed must be 'true' or 'false'");
      }
      where.passed = passed === "true";
    }

    const skip = (page - 1) * limit;
    if (skip > MAX_OFFSET) {
      return sendError(res, 400, "Requested page is too large");
    }

    const [submissions, total] = await prisma.$transaction([
      prisma.submission.findMany({
        where,
        select: {
          id: true,
          score: true,
          passed: true,
          attemptNumber: true,
          reportUrl: true,
          createdAt: true,
          challenge: {
            select: {
              id: true,
              title: true,
              domain: true,
              difficulty: true,
              points: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.submission.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return sendSuccess(res, "Fetched submissions", 200, {
      submissions,
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

/* Public Submissions */

export const publicSubmissions = async (
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

    // --- Filters ---
    // Only passed submissions are public — failed attempts stay private.
    const where: Prisma.SubmissionWhereInput = { passed: true };

    const { challengeId } = req.query;
    if (typeof challengeId === "string" && challengeId !== "") {
      where.challengeId = challengeId;
    }

    const skip = (page - 1) * limit;
    if (skip > MAX_OFFSET) {
      return sendError(res, 400, "Requested page is too large");
    }

    const [submissions, total] = await prisma.$transaction([
      prisma.submission.findMany({
        where,
        // CRITICAL: never expose `answers` here — that would let users copy solutions
        select: {
          id: true,
          score: true,
          attemptNumber: true,
          createdAt: true,
          challenge: {
            select: {
              id: true,
              title: true,
              domain: true,
              difficulty: true,
              points: true,
            },
          },
          user: {
            select: { id: true, username: true, avatar: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.submission.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return sendSuccess(res, "Fetched public submissions", 200, {
      submissions,
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

export const getPublicUserCompletedChallenges = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const username = req.params.username as string;
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
      },
    });

    if (!user) {
      return sendError(res, 404, "User not found");
    }

    const passedSubmissions = await prisma.submission.findMany({
      where: {
        userId: user.id,
        passed: true,
        challenge: { deletedAt: null },
      },
      select: {
        score: true,
        createdAt: true,
        challenge: {
          select: {
            id: true,
            title: true,
            domain: true,
            difficulty: true,
            points: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const challengeMap = new Map<
      string,
      {
        challenge: {
          id: string;
          title: string;
          domain: string;
          difficulty: string;
          points: number;
        };
        bestScore: number;
        lastPassedAt: Date;
      }
    >();

    for (const submission of passedSubmissions) {
      const existing = challengeMap.get(submission.challenge.id);

      if (!existing) {
        challengeMap.set(submission.challenge.id, {
          challenge: submission.challenge,
          bestScore: submission.score,
          lastPassedAt: submission.createdAt,
        });
        continue;
      }

      existing.bestScore = Math.max(existing.bestScore, submission.score);
      if (submission.createdAt > existing.lastPassedAt) {
        existing.lastPassedAt = submission.createdAt;
      }
    }

    const completedChallenges = Array.from(challengeMap.values()).sort(
      (left, right) =>
        right.lastPassedAt.getTime() - left.lastPassedAt.getTime(),
    );

    const total = completedChallenges.length;
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    if (skip > MAX_OFFSET) {
      return sendError(res, 400, "Requested page is too large");
    }

    return sendSuccess(res, "Fetched completed challenges", 200, {
      user: {
        username: user.username,
        avatar: user.avatar,
      },
      completedChallenges: completedChallenges.slice(skip, skip + limit),
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

export const listMyChallengeSubmissions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const challengeId = req.params.challengeId as string;
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

    const challenge = await prisma.challenge.findFirst({
      where: { id: challengeId, deletedAt: null },
      select: {
        id: true,
        title: true,
        domain: true,
        difficulty: true,
        points: true,
      },
    });

    if (!challenge) {
      return sendError(res, 404, "Challenge not found");
    }

    const skip = (page - 1) * limit;
    if (skip > MAX_OFFSET) {
      return sendError(res, 400, "Requested page is too large");
    }

    const where: Prisma.SubmissionWhereInput = {
      userId: req.user!.id,
      challengeId,
    };

    const [submissions, total] = await prisma.$transaction([
      prisma.submission.findMany({
        where,
        select: {
          id: true,
          score: true,
          passed: true,
          attemptNumber: true,
          reportUrl: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.submission.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return sendSuccess(res, "Fetched challenge submissions", 200, {
      challenge,
      submissions,
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

/* Get a Particular Submission  */

export const getAParticularSubmission = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const id = req.params.id as string;

    // First, light fetch to check ownership + passed status
    const meta = await prisma.submission.findUnique({
      where: { id },
      select: { userId: true, passed: true },
    });

    if (!meta) {
      return sendError(res, 404, "Submission not found");
    }

    const isOwner = meta.userId === req.user!.id;

    // Failed submissions are private — only owner can see
    if (!isOwner && !meta.passed) {
      return sendError(res, 403, "This submission is private");
    }

    // Owner gets full detail (including their answers).
    // Non-owner viewing a passed submission gets the public view (no answers).
    const submission = await prisma.submission.findUnique({
      where: { id },
      select: {
        id: true,
        score: true,
        passed: true,
        attemptNumber: true,
        reportUrl: true,
        createdAt: true,
        ...(isOwner && { answers: true }),
        challenge: {
          select: {
            id: true,
            title: true,
            domain: true,
            difficulty: true,
            points: true,
            ...(isOwner && {
              questions: {
                select: {
                  id: true,
                  text: true,
                  order: true,
                },
                orderBy: { order: "asc" as const },
              },
            }),
          },
        },
        user: {
          select: { id: true, username: true, avatar: true },
        },
      },
    });

    if (!submission) {
      return sendError(res, 404, "Submission not found");
    }

    if (!isOwner) {
      return sendSuccess(res, "Fetched submission", 200, submission);
    }

    const answerReview = buildSubmissionReview(
      submission.challenge.questions,
      submission.answers,
    );

    const { questions, ...challenge } = submission.challenge;

    return sendSuccess(res, "Fetched submission", 200, {
      ...submission,
      challenge,
      answerReview,
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};
