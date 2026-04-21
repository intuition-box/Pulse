-- AlterTable
ALTER TABLE "User" ADD COLUMN "bio" TEXT;
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "discordId" TEXT;
ALTER TABLE "User" ADD COLUMN "discordName" TEXT;
ALTER TABLE "User" ADD COLUMN "discordAvatar" TEXT;
ALTER TABLE "User" ADD COLUMN "xId" TEXT;
ALTER TABLE "User" ADD COLUMN "xName" TEXT;
ALTER TABLE "User" ADD COLUMN "xAvatar" TEXT;
ALTER TABLE "User" ADD COLUMN "githubId" TEXT;
ALTER TABLE "User" ADD COLUMN "githubName" TEXT;
ALTER TABLE "User" ADD COLUMN "githubAvatar" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");
CREATE UNIQUE INDEX "User_xId_key" ON "User"("xId");
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");
