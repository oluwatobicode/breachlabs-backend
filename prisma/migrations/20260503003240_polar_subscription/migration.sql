/*
  Warnings:

  - You are about to drop the column `paystackCustomerId` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[polarSubscriptionId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "User_paystackCustomerId_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "paystackCustomerId",
ADD COLUMN     "polarCustomerId" TEXT,
ADD COLUMN     "polarSubscriptionId" TEXT,
ADD COLUMN     "subscriptionEndsAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_polarSubscriptionId_key" ON "User"("polarSubscriptionId");

-- CreateIndex
CREATE INDEX "User_polarCustomerId_idx" ON "User"("polarCustomerId");
