/*
  Warnings:

  - A unique constraint covering the columns `[challengeId,order]` on the table `Question` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,challengeId,attemptNumber]` on the table `Submission` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE INDEX "Challenge_domain_difficulty_isFree_idx" ON "Challenge"("domain", "difficulty", "isFree");

-- CreateIndex
CREATE INDEX "Challenge_isFree_idx" ON "Challenge"("isFree");

-- CreateIndex
CREATE UNIQUE INDEX "Question_challengeId_order_key" ON "Question"("challengeId", "order");

-- CreateIndex
CREATE INDEX "Submission_userId_idx" ON "Submission"("userId");

-- CreateIndex
CREATE INDEX "Submission_challengeId_idx" ON "Submission"("challengeId");

-- CreateIndex
CREATE INDEX "Submission_userId_passed_idx" ON "Submission"("userId", "passed");

-- CreateIndex
CREATE INDEX "Submission_passed_createdAt_idx" ON "Submission"("passed", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_userId_challengeId_attemptNumber_key" ON "Submission"("userId", "challengeId", "attemptNumber");

-- CreateIndex
CREATE INDEX "User_paystackCustomerId_idx" ON "User"("paystackCustomerId");
