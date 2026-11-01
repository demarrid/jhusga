CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "sourceModifiedTime" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'held',
    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentVersion_revisionId_status_idx" ON "DocumentVersion"("revisionId", "status");
CREATE INDEX "DocumentVersion_status_observedAt_idx" ON "DocumentVersion"("status", "observedAt");
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "DocumentRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve a baseline even for imports which predate snapshot storage.
-- A held document's metadata describes the pending source, not its public text.
INSERT INTO "DocumentRevision" ("id", "documentId", "title", "content", "contentHash", "driveModifiedTime", "fetchedAt", "editorName", "editorEmail", "reviewedBy")
SELECT 'baseline:' || d."id", d."id", d."title", d."content", d."contentHash",
       CASE WHEN d."reviewState" = 'published' THEN d."driveModifiedTime" END,
       CURRENT_TIMESTAMP, '', '', ''
FROM "Document" d WHERE d."contentHash" <> ''
ON CONFLICT ("documentId", "contentHash") DO NOTHING;

-- Legacy rows do not say whether automatic publication happened. Only expose
-- text known to be current or explicitly accepted; retain everything else.
INSERT INTO "DocumentVersion" ("id", "revisionId", "sourceModifiedTime", "observedAt", "status")
SELECT r."id" || ':' || to_char(COALESCE(r."driveModifiedTime", r."fetchedAt"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), r."id", r."driveModifiedTime", r."fetchedAt",
       CASE WHEN r."id" = d."heldRevisionId" THEN 'held'
            WHEN r."contentHash" = d."rejectedContentHash" THEN 'rejected'
            WHEN r."contentHash" = d."contentHash" OR r."reviewedAt" IS NOT NULL THEN 'published'
            ELSE 'unknown' END
FROM "DocumentRevision" r JOIN "Document" d ON d."id" = r."documentId";
