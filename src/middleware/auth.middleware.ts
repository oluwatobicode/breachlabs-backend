import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/db.config";
import { ApiError } from "../utils/ApiError";
import { Role } from "../generated/prisma/enums";

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { userId } = getAuth(req);

    if (!userId) {
      throw new ApiError(401, "Unauthorized");
    }

    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!user) {
      throw new ApiError(
        401,
        "User not found — ensure Clerk webhook is configured",
      );
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      throw new ApiError(401, "Unauthorized");
    }

    if (req.user.role !== Role.ADMIN) {
      throw new ApiError(403, "Admin access required");
    }

    next();
  } catch (err) {
    next(err);
  }
};
