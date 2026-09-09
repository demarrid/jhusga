-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "displayTitle" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "driveCreatedTime" TIMESTAMP(3);
