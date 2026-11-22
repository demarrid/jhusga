CREATE TABLE "NewsletterCheckpoint" (
    "id" TEXT NOT NULL,
    "checkedThrough" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NewsletterCheckpoint_pkey" PRIMARY KEY ("id")
);
