/*
  Warnings:

  - Added the required column `updatedAt` to the `DailyBrief` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DailyBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "briefDate" DATETIME NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DailyBrief" ("briefDate", "content", "createdAt", "id", "userId") SELECT "briefDate", "content", "createdAt", "id", "userId" FROM "DailyBrief";
DROP TABLE "DailyBrief";
ALTER TABLE "new_DailyBrief" RENAME TO "DailyBrief";
CREATE UNIQUE INDEX "DailyBrief_userId_briefDate_key" ON "DailyBrief"("userId", "briefDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
