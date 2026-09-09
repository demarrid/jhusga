-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "meetingKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "meetingRole" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "meetingsPaired" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "referencesLinked" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DocumentReference" (
    "id" TEXT NOT NULL,
    "fromDocumentId" TEXT NOT NULL,
    "toDocumentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "anchorText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSummary" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'empty',
    "model" TEXT NOT NULL DEFAULT '',
    "promptHash" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSummaryCitation" (
    "id" TEXT NOT NULL,
    "summaryId" TEXT NOT NULL,
    "annotationId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSummaryCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentReference_toDocumentId_idx" ON "DocumentReference"("toDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentReference_fromDocumentId_toDocumentId_key" ON "DocumentReference"("fromDocumentId", "toDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSummary_documentId_key" ON "DocumentSummary"("documentId");

-- CreateIndex
CREATE INDEX "DocumentSummary_status_idx" ON "DocumentSummary"("status");

-- CreateIndex
CREATE INDEX "DocumentSummaryCitation_summaryId_ordinal_idx" ON "DocumentSummaryCitation"("summaryId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSummaryCitation_summaryId_annotationId_key" ON "DocumentSummaryCitation"("summaryId", "annotationId");

-- CreateIndex
CREATE INDEX "Document_meetingKey_idx" ON "Document"("meetingKey");

-- AddForeignKey
ALTER TABLE "DocumentReference" ADD CONSTRAINT "DocumentReference_fromDocumentId_fkey" FOREIGN KEY ("fromDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReference" ADD CONSTRAINT "DocumentReference_toDocumentId_fkey" FOREIGN KEY ("toDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSummary" ADD CONSTRAINT "DocumentSummary_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSummaryCitation" ADD CONSTRAINT "DocumentSummaryCitation_summaryId_fkey" FOREIGN KEY ("summaryId") REFERENCES "DocumentSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSummaryCitation" ADD CONSTRAINT "DocumentSummaryCitation_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "DocumentAnnotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
