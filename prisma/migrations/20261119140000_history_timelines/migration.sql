-- CreateTable
CREATE TABLE "HistoryTopic" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'empty',
    "model" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoryTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryFinding" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'none',
    "findings" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoryFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryEvent" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "batchKey" TEXT NOT NULL,
    "batchHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "datePrecision" TEXT NOT NULL DEFAULT 'day',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "thread" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "involvement" TEXT NOT NULL DEFAULT 'sga',
    "outcome" TEXT NOT NULL DEFAULT '',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryEventCitation" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "annotationId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HistoryEventCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HistoryTopic_slug_key" ON "HistoryTopic"("slug");

-- CreateIndex
CREATE INDEX "HistoryFinding_documentId_idx" ON "HistoryFinding"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "HistoryFinding_topicId_documentId_key" ON "HistoryFinding"("topicId", "documentId");

-- CreateIndex
CREATE INDEX "HistoryEvent_topicId_occurredAt_idx" ON "HistoryEvent"("topicId", "occurredAt");

-- CreateIndex
CREATE INDEX "HistoryEvent_topicId_batchKey_idx" ON "HistoryEvent"("topicId", "batchKey");

-- CreateIndex
CREATE INDEX "HistoryEventCitation_annotationId_idx" ON "HistoryEventCitation"("annotationId");

-- CreateIndex
CREATE UNIQUE INDEX "HistoryEventCitation_eventId_annotationId_key" ON "HistoryEventCitation"("eventId", "annotationId");

-- AddForeignKey
ALTER TABLE "HistoryFinding" ADD CONSTRAINT "HistoryFinding_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "HistoryTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryFinding" ADD CONSTRAINT "HistoryFinding_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryEvent" ADD CONSTRAINT "HistoryEvent_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "HistoryTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryEventCitation" ADD CONSTRAINT "HistoryEventCitation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "HistoryEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryEventCitation" ADD CONSTRAINT "HistoryEventCitation_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "DocumentAnnotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

