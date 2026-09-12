-- The date a document states about itself, derived at ingest by
-- documentDate in lib/identity.ts. Nullable because most of the archive's
-- working documents state nothing; Drive's timestamps stand in for those.
ALTER TABLE "Document" ADD COLUMN "datedAt" TIMESTAMP(3);

-- The listing and the date-aware search both order by it.
CREATE INDEX "Document_datedAt_idx" ON "Document"("datedAt");
