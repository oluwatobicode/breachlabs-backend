import "dotenv/config";
import { prisma } from "../config/db.config";
import { Role } from "../generated/prisma/enums";

const email = process.argv[2];
if (!email) {
  console.error("Usage: ts-node scripts/promote-admin.ts <email>");
  process.exit(1);
}

(async () => {
  const user = await prisma.user.update({
    where: { email },
    data: { role: Role.ADMIN },
  });
  console.log(`✅ Promoted ${user.email} to ${user.role}`);
  await prisma.$disconnect();
})();
