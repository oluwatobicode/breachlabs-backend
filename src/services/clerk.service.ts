import { prisma } from "../config/db.config";
import { ClerkUserData } from "../types/ClerkUserData";

const getPrimaryEmail = (data: ClerkUserData): string => {
  const primary = data.email_addresses.find(
    (e) => e.id === data.primary_email_address_id,
  );
  if (!primary) throw new Error("No primary email on Clerk user");
  return primary.email_address;
};

const getProvider = (data: ClerkUserData): string => {
  const external = data.external_accounts[0]?.provider ?? "";
  if (external.includes("google")) return "google";
  return "email";
};

const generateUsername = async (base: string): Promise<string> => {
  const exists = await prisma.user.findUnique({ where: { username: base } });
  if (!exists) return base;
  // append last 4 chars of a random number until unique
  let candidate = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    candidate = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return candidate;
};

export const syncUserCreated = async (data: ClerkUserData) => {
  const email = getPrimaryEmail(data);
  const base = data.username ?? email.split("@")[0];
  const username = await generateUsername(base);

  await prisma.user.create({
    data: {
      clerkId: data.id,
      username,
      email,
      avatar: data.image_url,
      provider: getProvider(data),
    },
  });
};

export const syncUserUpdated = async (data: ClerkUserData) => {
  const email = getPrimaryEmail(data);
  const base = data.username ?? email.split("@")[0];

  await prisma.user.upsert({
    where: { clerkId: data.id },
    update: {
      username: base,
      email,
      avatar: data.image_url,
    },
    create: {
      clerkId: data.id,
      username: await generateUsername(base),
      email,
      avatar: data.image_url,
      provider: getProvider(data),
    },
  });
};

export const syncUserDeleted = async (data: { id: string }) => {
  await prisma.user.delete({
    where: { clerkId: data.id },
  });
};
