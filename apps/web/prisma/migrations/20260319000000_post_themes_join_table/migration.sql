-- CreateTable
CREATE TABLE "PostTheme" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "themeSlug" TEXT NOT NULL,

    CONSTRAINT "PostTheme_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostTheme_postId_themeSlug_key" ON "PostTheme"("postId", "themeSlug");

-- CreateIndex
CREATE INDEX "PostTheme_themeSlug_idx" ON "PostTheme"("themeSlug");

-- AddForeignKey
ALTER TABLE "PostTheme" ADD CONSTRAINT "PostTheme_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostTheme" ADD CONSTRAINT "PostTheme_themeSlug_fkey" FOREIGN KEY ("themeSlug") REFERENCES "Theme"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migrate existing data: copy Post.themeSlug → PostTheme
INSERT INTO "PostTheme" ("id", "postId", "themeSlug")
SELECT gen_random_uuid()::text, "id", "themeSlug" FROM "Post";

-- Drop old FK and column
ALTER TABLE "Post" DROP CONSTRAINT "Post_themeSlug_fkey";
DROP INDEX "Post_themeSlug_createdAt_idx";
ALTER TABLE "Post" DROP COLUMN "themeSlug";

-- CreateIndex (new)
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");
