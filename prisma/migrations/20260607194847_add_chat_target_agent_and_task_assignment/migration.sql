-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "targetAgent" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "assignedAgent" TEXT;
ALTER TABLE "Task" ADD COLUMN "delegatedBy" TEXT;
ALTER TABLE "Task" ADD COLUMN "resolvedAt" DATETIME;

-- CreateIndex
CREATE INDEX "ChatMessage_userId_targetAgent_createdAt_idx" ON "ChatMessage"("userId", "targetAgent", "createdAt");
