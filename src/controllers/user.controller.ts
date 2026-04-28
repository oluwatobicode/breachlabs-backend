import type { Request, Response, NextFunction } from "express";
import { updateUserProfile, getPublicProfile } from "../services/user.service";
import { sendSuccess } from "../utils/ApiResponse";
import type { UpdateMeInput } from "../types/user.types";

export const getMe = (req: Request, res: Response) => {
  sendSuccess(res, req.user);
};

export const updateMe = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const updated = await updateUserProfile(
      req.user!.id,
      req.user!.clerkId,
      req.body as UpdateMeInput
    );
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
};

export const getPublicUserProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const profile = await getPublicProfile(req.params.username as string);
    sendSuccess(res, profile);
  } catch (err) {
    next(err);
  }
};
