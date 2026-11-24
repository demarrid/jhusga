CREATE TABLE "PersonMentionReview" (
    "key" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "input" TEXT NOT NULL,
    "decisions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonMentionReview_pkey" PRIMARY KEY ("key")
);
