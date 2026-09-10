-- Posts cannot be deleted by whoever wrote them.
--
-- manageTokenHash held a per-post secret that authorised an author-side
-- delete. Dropping the power means dropping the column: a secret nothing
-- checks is not a feature, it is a hash sitting next to a post for no reason.
--
-- Removal now happens only through a moderator, which writes a row to
-- ModerationAction and so appears in the public log. See the note in
-- lib/login.ts for why self-deletion is the wrong power on an anonymous forum.
ALTER TABLE "ForumPost" DROP COLUMN IF EXISTS "manageTokenHash";
ALTER TABLE "ForumReply" DROP COLUMN IF EXISTS "manageTokenHash";
