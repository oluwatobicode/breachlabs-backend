import type { Request, Response, NextFunction } from "express";
import type { Role } from "../generated/prisma/client";
import { ApiError } from "../utils/ApiError";

export const requireRole = (...roles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, "Unauthorized"));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, "Forbidden"));
    }

    next();
  };
};
