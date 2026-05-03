import { prisma } from "../config/db.config";
import { Role, SubscriptionStatus } from "../generated/prisma/enums";

type SubscriptionPayload = {
  id: string;
  status: string;
  currentPeriodEnd: string | Date | null;
  customer: {
    id: string;
    externalId?: string | null;
  };
};

const findUser = async (data: SubscriptionPayload) => {
  const externalId = data.customer.externalId;
  if (!externalId) {
    console.warn("Polar webhook: missing customer.externalId", {
      subscriptionId: data.id,
    });
    return null;
  }
  return prisma.user.findUnique({ where: { id: externalId } });
};

export const handleSubscriptionActivated = async (
  data: SubscriptionPayload,
) => {
  const user = await findUser(data);
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      subscriptionStatus: SubscriptionStatus.PRO,
      role: Role.PRO_USER,
      polarSubscriptionId: data.id,
      polarCustomerId: data.customer.id,
      subscriptionEndsAt: data.currentPeriodEnd
        ? new Date(data.currentPeriodEnd)
        : null,
    },
  });
};

export const handleSubscriptionUpdated = async (data: SubscriptionPayload) => {
  const user = await findUser(data);
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      polarSubscriptionId: data.id,
      polarCustomerId: data.customer.id,
      subscriptionEndsAt: data.currentPeriodEnd
        ? new Date(data.currentPeriodEnd)
        : null,
    },
  });
};

export const handleSubscriptionRevoked = async (data: SubscriptionPayload) => {
  const user = await findUser(data);
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      subscriptionStatus: SubscriptionStatus.FREE,
      role: Role.USER,
      polarSubscriptionId: null,
      subscriptionEndsAt: null,
    },
  });
};
