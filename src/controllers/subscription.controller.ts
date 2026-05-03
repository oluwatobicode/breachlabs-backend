import type { NextFunction, Response, Request } from "express";
import { sendSuccess } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import polar from "../services/polar.service";
import { env } from "../config/env";

type Interval = "monthly" | "yearly";

export const createCheckout = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user!;
    const { interval } = req.body as { interval?: Interval };

    if (interval !== "monthly" && interval !== "yearly") {
      throw new ApiError(400, "interval must be 'monthly' or 'yearly'");
    }

    const productId =
      interval === "monthly"
        ? env.POLAR_MONTHLY_PRODUCT_ID
        : env.POLAR_YEARLY_PRODUCT_ID;

    const checkout = await polar.checkouts.create({
      products: [productId],
      customerEmail: user.email,
      externalCustomerId: user.id,
      successUrl: env.CHECKOUT_SUCCESS_URL,
    });

    sendSuccess(res, "Checkout session created", 201, { url: checkout.url });
  } catch (err) {
    next(err);
    console.log(err);
  }
};

export const getPortalUrl = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user!;

    const session = await polar.customerSessions.create({
      externalCustomerId: user.id,
    });

    sendSuccess(res, "Portal URL created", 200, {
      url: session.customerPortalUrl,
    });
  } catch (err) {
    next(err);
    console.log(err);
  }
};
