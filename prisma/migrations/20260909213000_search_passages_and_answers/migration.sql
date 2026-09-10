-- CreateTable
CREATE TABLE "DocumentPassage" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "heading" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentPassage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchAnswer" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'current',
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'empty',
    "model" TEXT NOT NULL DEFAULT '',
    "promptHash" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "generatedAt" TIMESTAMP(3),
    "askedCount" INTEGER NOT NULL DEFAULT 0,
    "lastAskedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchAnswerCitation" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "annotationId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SearchAnswerCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentPassage_documentId_idx" ON "DocumentPassage"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPassage_documentId_ordinal_key" ON "DocumentPassage"("documentId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "SearchAnswer_questionKey_key" ON "SearchAnswer"("questionKey");

-- CreateIndex
CREATE INDEX "SearchAnswer_status_idx" ON "SearchAnswer"("status");

-- CreateIndex
CREATE INDEX "SearchAnswer_lastAskedAt_idx" ON "SearchAnswer"("lastAskedAt");

-- CreateIndex
CREATE INDEX "SearchAnswerCitation_annotationId_idx" ON "SearchAnswerCitation"("annotationId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchAnswerCitation_answerId_annotationId_key" ON "SearchAnswerCitation"("answerId", "annotationId");

-- AddForeignKey
ALTER TABLE "DocumentPassage" ADD CONSTRAINT "DocumentPassage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchAnswerCitation" ADD CONSTRAINT "SearchAnswerCitation_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "SearchAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchAnswerCitation" ADD CONSTRAINT "SearchAnswerCitation_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "DocumentAnnotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The full-text index behind passage retrieval.
--
-- An expression index rather than a stored tsvector column, so that Prisma has
-- no column it does not know about and will not offer to drop one on the next
-- migrate. Queries in lib/search.ts must spell the expression exactly as it is
-- written here, or the planner will sequential-scan instead of using this.
CREATE INDEX "DocumentPassage_fts_idx" ON "DocumentPassage"
    USING GIN (to_tsvector('english', "heading" || ' ' || "content"));
