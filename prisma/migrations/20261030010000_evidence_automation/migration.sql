CREATE TABLE "AdministratorLookup" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT,
    "mention" TEXT NOT NULL,
    "office" TEXT,
    "status" TEXT NOT NULL,
    "fullName" TEXT,
    "evidence" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AdministratorLookup_documentId_idx" ON "AdministratorLookup"("documentId");
CREATE INDEX "AdministratorLookup_expiresAt_idx" ON "AdministratorLookup"("expiresAt");

CREATE TABLE "AmendmentClearance" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "derivedUpdatedAt" TIMESTAMP(3)
);
CREATE INDEX "AmendmentClearance_documentId_checkedAt_idx" ON "AmendmentClearance"("documentId", "checkedAt");
CREATE INDEX "AmendmentClearance_revisionId_idx" ON "AmendmentClearance"("revisionId");
