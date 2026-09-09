-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "driveLastEditorEmail" TEXT,
ADD COLUMN     "driveLastEditorName" TEXT,
ADD COLUMN     "driveOwnerEmail" TEXT,
ADD COLUMN     "driveOwnerName" TEXT;

-- AlterTable
ALTER TABLE "HopkinsAffiliate" ADD COLUMN     "nameKey" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "contributorsLinked" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DocumentContributor" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "hopkinsAffiliateId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'present',
    "source" TEXT NOT NULL DEFAULT 'parsed',
    "evidence" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentContributor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentContributor_hopkinsAffiliateId_idx" ON "DocumentContributor"("hopkinsAffiliateId");

-- CreateIndex
CREATE INDEX "DocumentContributor_role_idx" ON "DocumentContributor"("role");

-- CreateIndex
CREATE INDEX "DocumentContributor_documentId_idx" ON "DocumentContributor"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentContributor_documentId_hopkinsAffiliateId_role_key" ON "DocumentContributor"("documentId", "hopkinsAffiliateId", "role");

-- CreateIndex
CREATE INDEX "Document_driveOwnerEmail_idx" ON "Document"("driveOwnerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "HopkinsAffiliate_nameKey_key" ON "HopkinsAffiliate"("nameKey");

-- CreateIndex
CREATE INDEX "HopkinsAffiliate_name_idx" ON "HopkinsAffiliate"("name");

-- AddForeignKey
ALTER TABLE "DocumentContributor" ADD CONSTRAINT "DocumentContributor_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentContributor" ADD CONSTRAINT "DocumentContributor_hopkinsAffiliateId_fkey" FOREIGN KEY ("hopkinsAffiliateId") REFERENCES "HopkinsAffiliate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

