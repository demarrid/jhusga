import { SESSION_NUMBER } from "@/config/session";

/**
 * The yearly change surface.
 *
 * When a new session begins, the only edits needed to repoint the whole ingest
 * pipeline are MASTER_FOLDER_ID here and SESSION_NUMBER in config/session.ts.
 */

export { SESSION_NUMBER };

/**
 * Copy this out of the master folder URL:
 *   drive.google.com/drive/folders/<MASTER_FOLDER_ID>
 *
 * Overridable by env so a deploy can be repointed without a code change.
 */
export const MASTER_FOLDER_ID =
    process.env.SGA_MASTER_FOLDER_ID || "1FNVLX3o1QAulNi0JY7XwOxHpQ6Oa0KIg";

/**
 * Each master folder nests the previous session's, so a single walk reaches
 * every session the SGA has kept. A folder matching this pattern marks the
 * boundary: everything beneath it belongs to the captured session number and
 * is archive, not current law.
 *
 * Matches e.g. "113th SGA Master Folder 2025-2026".
 */
export const ARCHIVE_FOLDER_PATTERN = /^(\d+)\s*(?:st|nd|rd|th)\s+SGA Master Folder/i;

/**
 * Folders skipped entirely. Kept deliberately short -- the point of the
 * archive is to chronicle everything, so only folders that cannot contain
 * readable governing text are excluded.
 */
export const EXCLUDED_FOLDER_PATTERNS: RegExp[] = [/^Images$/i];

/** How deep to recurse below the master folder before giving up. */
export const MAX_FOLDER_DEPTH = 10;

/**
 * How many rounds of link-following to run after the walk.
 *
 * A bill linked from an agenda routinely links the bill it amends, so one
 * round is not enough; but the further a document is from anything filed in
 * the master folder, the weaker the claim that it is SGA business at all. Two
 * rounds reaches what the Senate read and what that in turn cited, and stops
 * before the archive starts collecting somebody's lecture notes.
 */
export const MAX_LINK_ROUNDS = 2;

/**
 * Guard against a misconfigured folder ID walking all of Drive. Raised to
 * accommodate the nested archive of prior sessions.
 */
export const MAX_FILES_PER_SYNC = 20_000;
