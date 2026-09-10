-- The unused Post/Comment sketch, replaced below by the forum proper. Neither
-- was ever written to by application code.
DROP TABLE IF EXISTS "Comment";
DROP TABLE IF EXISTS "Post";

-- AlterTable: document review state
ALTER TABLE "Document" ADD COLUMN     "anyoneCanEdit" BOOLEAN;
ALTER TABLE "Document" ADD COLUMN     "reviewState" TEXT NOT NULL DEFAULT 'published';
ALTER TABLE "Document" ADD COLUMN     "heldRevisionId" TEXT;
ALTER TABLE "Document" ADD COLUMN     "heldReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Document" ADD COLUMN     "heldAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN     "rejectedContentHash" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "DocumentRevision" ADD COLUMN     "reviewedAt" TIMESTAMP(3);
ALTER TABLE "DocumentRevision" ADD COLUMN     "reviewedBy" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Document_reviewState_idx" ON "Document"("reviewState");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_heldRevisionId_fkey" FOREIGN KEY ("heldRevisionId") REFERENCES "DocumentRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ForumCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ForumCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginCode" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "hopkinsAffiliateId" TEXT,

    CONSTRAINT "ForumSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumPost" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorAffiliateId" TEXT,
    "authorLabel" TEXT NOT NULL DEFAULT '',
    "manageTokenHash" TEXT NOT NULL,
    "screenState" TEXT NOT NULL DEFAULT 'skipped',
    "screenReason" TEXT NOT NULL DEFAULT '',
    "hiddenAt" TIMESTAMP(3),
    "hiddenReason" TEXT NOT NULL DEFAULT '',
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "ForumPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForumReply" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorAffiliateId" TEXT,
    "authorLabel" TEXT NOT NULL DEFAULT '',
    "manageTokenHash" TEXT NOT NULL,
    "screenState" TEXT NOT NULL DEFAULT 'skipped',
    "screenReason" TEXT NOT NULL DEFAULT '',
    "hiddenAt" TIMESTAMP(3),
    "hiddenReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ForumReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "actorLabel" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForumCategory_slug_key" ON "ForumCategory"("slug");

-- CreateIndex
CREATE INDEX "LoginCode_emailHash_idx" ON "LoginCode"("emailHash");

-- CreateIndex
CREATE INDEX "LoginCode_expiresAt_idx" ON "LoginCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForumSession_tokenHash_key" ON "ForumSession"("tokenHash");

-- CreateIndex
CREATE INDEX "ForumSession_expiresAt_idx" ON "ForumSession"("expiresAt");

-- CreateIndex
CREATE INDEX "ForumPost_categoryId_createdAt_idx" ON "ForumPost"("categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_createdAt_idx" ON "ForumPost"("createdAt");

-- CreateIndex
CREATE INDEX "ForumPost_hiddenAt_idx" ON "ForumPost"("hiddenAt");

-- CreateIndex
CREATE INDEX "ForumPost_screenState_idx" ON "ForumPost"("screenState");

-- CreateIndex
CREATE INDEX "ForumReply_postId_createdAt_idx" ON "ForumReply"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumReply_screenState_idx" ON "ForumReply"("screenState");

-- CreateIndex
CREATE INDEX "ModerationAction_createdAt_idx" ON "ModerationAction"("createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_targetType_targetId_idx" ON "ModerationAction"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "RateBucket_expiresAt_idx" ON "RateBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "ForumSession" ADD CONSTRAINT "ForumSession_hopkinsAffiliateId_fkey" FOREIGN KEY ("hopkinsAffiliateId") REFERENCES "HopkinsAffiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ForumCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumPost" ADD CONSTRAINT "ForumPost_authorAffiliateId_fkey" FOREIGN KEY ("authorAffiliateId") REFERENCES "HopkinsAffiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForumReply" ADD CONSTRAINT "ForumReply_authorAffiliateId_fkey" FOREIGN KEY ("authorAffiliateId") REFERENCES "HopkinsAffiliate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
