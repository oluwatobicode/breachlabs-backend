import type { Response } from "express";

export const sendSuccess = (
  res: Response,
  message: string,
  statusCode = 200,
  data: unknown = undefined
) => {
  res.status(statusCode).json({ success: true, message, data });
};

export const sendError = (res: Response, statusCode: number, message: string) => {
  res.status(statusCode).json({ success: false, message });
};
