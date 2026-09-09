-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/vnd.google-apps.document',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'unknown',
    "folderPath" TEXT NOT NULL DEFAULT '',
    "sessionNumber" INTEGER,
    "lineageKey" TEXT NOT NULL DEFAULT '',
    "driveModifiedTime" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "driveModifiedTime" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAnnotation" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "orphanedAt" TIMESTAMP(3),
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedSection" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'empty',
    "model" TEXT NOT NULL DEFAULT '',
    "promptHash" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "annotationId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "masterFolderId" TEXT NOT NULL DEFAULT '',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "error" TEXT,
    "filesSeen" INTEGER NOT NULL DEFAULT 0,
    "documentsCreated" INTEGER NOT NULL DEFAULT 0,
    "documentsUpdated" INTEGER NOT NULL DEFAULT 0,
    "documentsUnchanged" INTEGER NOT NULL DEFAULT 0,
    "documentsArchived" INTEGER NOT NULL DEFAULT 0,
    "annotationsOrphaned" INTEGER NOT NULL DEFAULT 0,
    "sectionsInvalidated" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HopkinsAffiliate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "enrollmentStatus" TEXT NOT NULL DEFAULT 'unknown',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HopkinsAffiliate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HopkinsCategory" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HopkinsCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HopkinsRelationship" (
    "id" TEXT NOT NULL,
    "hopkinsAffiliateId" TEXT NOT NULL,
    "hopkinsCategoryId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HopkinsRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "postId" TEXT NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_driveFileId_key" ON "Document"("driveFileId");

-- CreateIndex
CREATE INDEX "Document_kind_idx" ON "Document"("kind");

-- CreateIndex
CREATE INDEX "Document_driveModifiedTime_idx" ON "Document"("driveModifiedTime");

-- CreateIndex
CREATE INDEX "Document_sessionNumber_idx" ON "Document"("sessionNumber");

-- CreateIndex
CREATE INDEX "Document_lineageKey_sessionNumber_idx" ON "Document"("lineageKey", "sessionNumber");

-- CreateIndex
CREATE INDEX "DocumentRevision_documentId_fetchedAt_idx" ON "DocumentRevision"("documentId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRevision_documentId_contentHash_key" ON "DocumentRevision"("documentId", "contentHash");

-- CreateIndex
CREATE INDEX "DocumentAnnotation_documentId_idx" ON "DocumentAnnotation"("documentId");

-- CreateIndex
CREATE INDEX "DocumentAnnotation_orphanedAt_idx" ON "DocumentAnnotation"("orphanedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedSection_key_key" ON "GeneratedSection"("key");

-- CreateIndex
CREATE INDEX "GeneratedSection_status_idx" ON "GeneratedSection"("status");

-- CreateIndex
CREATE INDEX "Citation_sectionId_ordinal_idx" ON "Citation"("sectionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "Citation_sectionId_annotationId_key" ON "Citation"("sectionId", "annotationId");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "HopkinsAffiliate_email_key" ON "HopkinsAffiliate"("email");

-- CreateIndex
CREATE UNIQUE INDEX "HopkinsAffiliate_userId_key" ON "HopkinsAffiliate"("userId");

-- CreateIndex
CREATE INDEX "HopkinsAffiliate_enrollmentStatus_idx" ON "HopkinsAffiliate"("enrollmentStatus");

-- CreateIndex
CREATE INDEX "HopkinsCategory_type_idx" ON "HopkinsCategory"("type");

-- CreateIndex
CREATE UNIQUE INDEX "HopkinsCategory_type_name_key" ON "HopkinsCategory"("type", "name");

-- CreateIndex
CREATE INDEX "HopkinsRelationship_hopkinsAffiliateId_idx" ON "HopkinsRelationship"("hopkinsAffiliateId");

-- CreateIndex
CREATE INDEX "HopkinsRelationship_hopkinsCategoryId_idx" ON "HopkinsRelationship"("hopkinsCategoryId");

-- CreateIndex
CREATE INDEX "HopkinsRelationship_endedAt_idx" ON "HopkinsRelationship"("endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HopkinsRelationship_hopkinsAffiliateId_hopkinsCategoryId_st_key" ON "HopkinsRelationship"("hopkinsAffiliateId", "hopkinsCategoryId", "startedAt");

-- CreateIndex
CREATE INDEX "Post_userId_idx" ON "Post"("userId");

-- CreateIndex
CREATE INDEX "Comment_postId_idx" ON "Comment"("postId");

-- AddForeignKey
ALTER TABLE "DocumentRevision" ADD CONSTRAINT "DocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAnnotation" ADD CONSTRAINT "DocumentAnnotation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "GeneratedSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "DocumentAnnotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HopkinsAffiliate" ADD CONSTRAINT "HopkinsAffiliate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HopkinsRelationship" ADD CONSTRAINT "HopkinsRelationship_hopkinsAffiliateId_fkey" FOREIGN KEY ("hopkinsAffiliateId") REFERENCES "HopkinsAffiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HopkinsRelationship" ADD CONSTRAINT "HopkinsRelationship_hopkinsCategoryId_fkey" FOREIGN KEY ("hopkinsCategoryId") REFERENCES "HopkinsCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
