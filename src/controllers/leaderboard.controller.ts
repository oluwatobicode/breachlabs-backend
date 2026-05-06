import { NextFunction, Request, Response } from "express";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_OFFSET,
} from "../config/constants.config";
import { getLeaderboardPage, getUserRankFromRedis } from "../services/redis.service";
import { sendError, sendSuccess } from "../utils/ApiResponse";

export const getLeaderBoard = async (
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

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return sendError(res, 400, `limit must be between 1 and ${MAX_LIMIT}`);
    }

    const skip = (page - 1) * limit;
    if (skip > MAX_OFFSET) {
      return sendError(res, 400, "Requested page is too large");
    }

    const start = skip;
    const stop = skip + limit - 1;
    const { entries, total } = await getLeaderboardPage(start, stop);
    const totalPages = Math.ceil(total / limit);

    const me = req.user
      ? await getUserRankFromRedis(req.user.id).then((currentUser) => ({
          userId: req.user!.id,
          username: req.user!.username,
          avatar: req.user!.avatar,
          rank: currentUser.rank,
          points: currentUser.points,
        }))
      : null;

    return sendSuccess(res, "Fetched leaderboard", 200, {
      entries,
      me,
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
