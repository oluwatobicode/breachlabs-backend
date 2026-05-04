import "./instrument";

import { prisma } from "./config/db.config";
import app from "./app";
const PORT = process.env.PORT || 5000;

async function main() {
  await prisma.$connect();
  console.log("Connected to the database");

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

main().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});
