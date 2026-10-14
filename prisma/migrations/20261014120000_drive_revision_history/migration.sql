CREATE TABLE "DriveRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "modifiedAt" TIMESTAMP(3) NOT NULL,
    "editorName" TEXT NOT NULL DEFAULT '',
    "editorEmail" TEXT NOT NULL DEFAULT '',
    "content" TEXT,
    CONSTRAINT "DriveRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DriveRevision_documentId_revisionId_key" ON "DriveRevision"("documentId", "revisionId");
CREATE INDEX "DriveRevision_documentId_modifiedAt_idx" ON "DriveRevision"("documentId", "modifiedAt");
ALTER TABLE "DriveRevision" ADD CONSTRAINT "DriveRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
