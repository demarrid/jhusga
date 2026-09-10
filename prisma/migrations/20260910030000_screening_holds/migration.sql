-- Screening holds a submission back instead of letting it through flagged.
--
-- hiddenBy records which of the two things withheld it. They are not the same
-- and should not render the same: a moderator's decision has a person behind
-- it and stays listed for anyone to argue with, while a screening hold is a
-- guess by a model that nobody has checked yet, and listing those would put
-- the spam it caught back in front of every reader.
--
-- Both are written to ModerationAction either way, so the holding is public
-- even while the held text is not.
ALTER TABLE "ForumPost" ADD COLUMN "hiddenBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ForumReply" ADD COLUMN "hiddenBy" TEXT NOT NULL DEFAULT '';

-- Anything already hidden was hidden by the only mechanism that existed.
UPDATE "ForumPost" SET "hiddenBy" = 'moderator' WHERE "hiddenAt" IS NOT NULL;
UPDATE "ForumReply" SET "hiddenBy" = 'moderator' WHERE "hiddenAt" IS NOT NULL;

CREATE INDEX "ForumPost_hiddenBy_idx" ON "ForumPost"("hiddenBy");
CREATE INDEX "ForumReply_hiddenBy_idx" ON "ForumReply"("hiddenBy");
