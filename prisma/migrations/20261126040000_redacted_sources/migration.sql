CREATE TABLE "DocumentRedactedSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "sourceFileIds" TEXT[],
    "sourceSha256" TEXT NOT NULL,
    "redactions" JSONB NOT NULL,
    "pageCount" INTEGER NOT NULL CHECK ("pageCount" > 0),
    "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'approved')),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocumentRedactedSource_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DocumentRedactedSource_documentId_key" ON "DocumentRedactedSource"("documentId");
CREATE INDEX "DocumentRedactedSource_status_idx" ON "DocumentRedactedSource"("status");
