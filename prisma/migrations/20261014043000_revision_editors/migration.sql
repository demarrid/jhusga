-- Who Drive named when a revision was first stored. Blank on revisions
-- saved before this was recorded, so a later count does not treat them as
-- somebody's work. The minutes taker is the account with the most of these.
ALTER TABLE "DocumentRevision" ADD COLUMN "editorName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DocumentRevision" ADD COLUMN "editorEmail" TEXT NOT NULL DEFAULT '';
