import type { User } from "../generated/prisma/client";
import { SubscriptionStatus } from "../generated/prisma/enums";

type UserWithSubscription = Pick<
  User,
  "subscriptionStatus" | "subscriptionEndsAt"
>;

export const hasActiveProAccess = (user?: UserWithSubscription | null) => {
  if (!user || user.subscriptionStatus !== SubscriptionStatus.PRO) {
    return false;
  }

  if (!user.subscriptionEndsAt) {
    return true;
  }

  return user.subscriptionEndsAt.getTime() > Date.now();
};
