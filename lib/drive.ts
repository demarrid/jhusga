import {
    ARCHIVE_FOLDER_PATTERN,
    EXCLUDED_FOLDER_PATTERNS,
    MAX_FILES_PER_SYNC,
    MAX_FOLDER_DEPTH,
    SESSION_NUMBER,
} from "@/config/sga";
import { restoreCellBreaks } from "@/lib/cells";
import { sanitizeExport } from "@/lib/markdown";

/**
 * Read-only Google Drive access.
 *
 * A bare API key is sufficient because the master folder is shared "anyone with
 * the link"; the Drive API serves public resources without OAuth. If the folder
 * is ever restricted, every call here starts returning 404 and this module has
 * to move to a service account (share the folder with the service account's
 * email, then swap the `key` query param for an Authorization header).
 */

const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";

/** A Drive account. Public files expose these even to a bare API key. */
export type DriveUser = {
    displayName: string | null;
    emailAddress: string | null;
};

export type DriveFile = {
    id: string;
    name: string;
    mimeType: string;
    createdTime: string | null;
    modifiedTime: string | null;
    webViewLink: string | null;
    owner: DriveUser | null;
    lastModifyingUser: DriveUser | null;
    /**
     * Whether a stranger can edit this file.
     *
     * Drive reports capabilities from the point of view of whoever asked, and
     * this project asks with a bare API key and no user. So `canEdit` here is
     * literally the answer Drive would give someone who found the link -- if
     * it is true, the file is shared "anyone with the link can edit".
     *
     * Null when Drive did not report capabilities at all, which is not the
     * same as false and must not be treated as reassurance.
     */
    anyoneCanEdit: boolean | null;
    /**
     * What this file points at, when it is a shortcut rather than a file.
     *
     * A shortcut is how Drive files something in two places at once, and the
     * SGA uses it for exactly that: each master folder holds the previous one,
     * but the 112th holds the 111th as a shortcut. Left unresolved, an entire
     * session is a single unreadable row.
     */
    shortcutTo: { id: string; mimeType: string } | null;
};

/** A file found by the walk, tagged with the folder trail that led to it. */
export type WalkedFile = DriveFile & {
    folderPath: string;
    /**
     * The SGA session this file belongs to, from the nearest enclosing
     * "Nth SGA Master Folder". Files not under any such folder belong to the
     * current session.
     */
    sessionNumber: number;
};

function apiKey(): string {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) {
        throw new Error(
            "GOOGLE_API_KEY is not set; create a Drive-restricted API key in the Google Cloud console",
        );
    }
    return key;
}

/**
 * Drive is rate limited per key, and a full sync is a few hundred calls, so
 * retry the failures that are worth retrying and fail fast on the rest.
 */
async function driveFetch(url: string, attempt = 0): Promise<Response> {
    const response = await fetch(url, { cache: "no-store" });

    if (response.ok) return response;

    const retriable = response.status === 429 || response.status >= 500;
    if (retriable && attempt < 4) {
        const backoffMs = 500 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return driveFetch(url, attempt + 1);
    }

    // Drive puts a useful reason in the body; surface it rather than a bare code.
    const body = await response.text().catch(() => "");
    throw new Error(
        `Drive API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    );
}

/**
 * The metadata worth having about a file, in the shape Drive returns it.
 *
 * `capabilities` is asked for unauthenticated on purpose; see anyoneCanEdit on
 * DriveFile. Drive omits the field rather than failing when it will not answer,
 * so asking costs nothing.
 */
const FILE_FIELDS =
    "id, name, mimeType, createdTime, modifiedTime, webViewLink," +
    " shortcutDetails(targetId, targetMimeType)," +
    " capabilities(canEdit, canModifyContent)," +
    " owners(displayName, emailAddress)," +
    " lastModifyingUser(displayName, emailAddress)";

type RawUser = { displayName?: string; emailAddress?: string };

type RawFile = {
    id?: string;
    name?: string;
    mimeType?: string;
    createdTime?: string;
    modifiedTime?: string;
    webViewLink?: string;
    shortcutDetails?: { targetId?: string; targetMimeType?: string };
    capabilities?: { canEdit?: boolean; canModifyContent?: boolean };
    owners?: RawUser[];
    lastModifyingUser?: RawUser;
};

function toUser(raw: RawUser | undefined): DriveUser | null {
    if (!raw?.displayName && !raw?.emailAddress) return null;
    return {
        displayName: raw.displayName ?? null,
        emailAddress: raw.emailAddress ?? null,
    };
}

function toDriveFile(raw: RawFile): DriveFile | null {
    if (!raw.id || !raw.name || !raw.mimeType) return null;
    return {
        id: raw.id,
        name: raw.name,
        mimeType: raw.mimeType,
        createdTime: raw.createdTime ?? null,
        modifiedTime: raw.modifiedTime ?? null,
        webViewLink: raw.webViewLink ?? null,
        // Drive returns a list, but SGA files have a single owner.
        owner: toUser(raw.owners?.[0]),
        lastModifyingUser: toUser(raw.lastModifyingUser),
        anyoneCanEdit: anonymousCanEdit(raw.capabilities),
        shortcutTo:
            raw.shortcutDetails?.targetId && raw.shortcutDetails.targetMimeType
                ? {
                    id: raw.shortcutDetails.targetId,
                    mimeType: raw.shortcutDetails.targetMimeType,
                }
                : null,
    };
}

/**
 * Both flags have to be true to call a file world-editable.
 *
 * `canEdit` is set on a file somebody can comment on but not change, so on its
 * own it would flag half the archive as open. `canModifyContent` is the one
 * that means the text can be rewritten.
 */
function anonymousCanEdit(
    capabilities: RawFile["capabilities"],
): boolean | null {
    if (!capabilities) return null;
    if (capabilities.canEdit === undefined && capabilities.canModifyContent === undefined) {
        return null;
    }
    return capabilities.canEdit === true && capabilities.canModifyContent === true;
}

/** One page-following pass over the immediate children of a folder. */
export async function listFolderChildren(
    folderId: string,
): Promise<DriveFile[]> {
    const children: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
        const params = new URLSearchParams({
            q: `'${folderId}' in parents and trashed = false`,
            fields: `nextPageToken, files(${FILE_FIELDS})`,
            pageSize: "1000",
            // Harmless for an ordinary folder, required if it ever becomes a
            // shared drive.
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
            key: apiKey(),
        });
        if (pageToken) params.set("pageToken", pageToken);

        const response = await driveFetch(
            `${DRIVE_FILES_ENDPOINT}?${params.toString()}`,
        );

        const payload = (await response.json()) as {
            files?: RawFile[];
            nextPageToken?: string;
        };

        for (const raw of payload.files ?? []) {
            const file = toDriveFile(raw);
            if (file) children.push(file);
        }

        pageToken = payload.nextPageToken;
    } while (pageToken);

    return children;
}

/**
 * One file by ID, or null when Drive will not serve it to us.
 *
 * Unlike everything reached by the folder walk, a file reached by following a
 * link is not inside the master folder and so is not covered by its "anyone
 * with the link" sharing. A good number of the bills the Senate reads live in
 * their author's own Drive and are shared with nobody. That is an ordinary
 * outcome rather than an error: the link stays unresolved, the reader still
 * has the URL the author typed, and the file appears the day it is shared.
 */
export async function getFile(fileId: string): Promise<DriveFile | null> {
    const params = new URLSearchParams({
        fields: FILE_FIELDS,
        supportsAllDrives: "true",
        key: apiKey(),
    });

    const response = await fetch(
        `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?${params.toString()}`,
        { cache: "no-store" },
    );

    // 404 is what Drive returns for both "no such file" and "not shared with
    // you"; 403 is the quota and permission family. Neither is worth failing a
    // sync over, and neither is worth retrying.
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `Drive API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
        );
    }

    return toDriveFile((await response.json()) as RawFile);
}

function isExcluded(folderName: string): boolean {
    return EXCLUDED_FOLDER_PATTERNS.some((pattern) => pattern.test(folderName));
}

/**
 * The session a folder introduces, or null if it is not an archive boundary.
 *
 * Each master folder nests the previous one, so descending through
 * "114th ... / 113th ... / 112th ..." reassigns the session at every level.
 */
export function archiveSessionFor(folderName: string): number | null {
    const match = ARCHIVE_FOLDER_PATTERN.exec(folderName);
    if (!match) return null;

    const session = Number.parseInt(match[1], 10);
    return Number.isFinite(session) ? session : null;
}

/**
 * Breadth-first walk of the master folder, yielding non-folder files.
 *
 * Drive folders form a graph rather than a tree (a file can have several
 * parents, and a shortcut files one folder inside another), so visited IDs are
 * tracked to avoid revisiting a subtree.
 *
 * Shortcuts are followed as though they were the thing they point at, because
 * to everyone using the Drive they are: the 112th master folder holds the 111th
 * as a shortcut, and until this followed them the 111th session did not exist
 * as far as the archive was concerned. The shortcut's own name is what is
 * followed into the folder path, since that is the name a reader clicked.
 */
export async function walkFolder(rootFolderId: string): Promise<WalkedFile[]> {
    const found: WalkedFile[] = [];
    const visited = new Set<string>([rootFolderId]);

    type QueuedFolder = {
        id: string;
        path: string;
        depth: number;
        sessionNumber: number;
    };

    // The walk starts inside the current master folder, so its own name is
    // never seen; everything at the root is therefore the current session.
    let queue: QueuedFolder[] = [
        { id: rootFolderId, path: "", depth: 0, sessionNumber: SESSION_NUMBER },
    ];

    while (queue.length > 0) {
        const next: QueuedFolder[] = [];

        for (const folder of queue) {
            const children = await listFolderChildren(folder.id);

            for (const child of children) {
                const target = child.shortcutTo;
                const isFolder =
                    child.mimeType === FOLDER_MIME || target?.mimeType === FOLDER_MIME;

                if (isFolder) {
                    const folderId = target?.id ?? child.id;
                    if (
                        isExcluded(child.name) ||
                        visited.has(folderId) ||
                        folder.depth + 1 > MAX_FOLDER_DEPTH
                    ) {
                        continue;
                    }
                    visited.add(folderId);
                    next.push({
                        id: folderId,
                        path: folder.path ? `${folder.path}/${child.name}` : child.name,
                        depth: folder.depth + 1,
                        sessionNumber:
                            archiveSessionFor(child.name) ?? folder.sessionNumber,
                    });
                    continue;
                }

                // A shortcut carries none of its target's own metadata -- no
                // modifiedTime to skip an unchanged export by, no owner, no
                // sharing -- so the target is fetched and the shortcut
                // discarded. It is the target that gets exported and stored.
                const file = target ? await getFile(target.id) : child;
                if (!file) continue;

                if (found.length >= MAX_FILES_PER_SYNC) {
                    throw new Error(
                        `Walk exceeded MAX_FILES_PER_SYNC (${MAX_FILES_PER_SYNC}); check MASTER_FOLDER_ID is the intended folder`,
                    );
                }
                found.push({
                    ...file,
                    folderPath: folder.path,
                    sessionNumber: folder.sessionNumber,
                });
            }
        }

        queue = next;
    }

    return found;
}

/**
 * The reasons Drive gives for having no text to give.
 *
 * A file it will not convert (a deck of scanned images, a doc past the export
 * size limit) is a fact about that file, not a failure of the sync -- and one
 * of them in a folder of two hundred must not stop the walk, which is what it
 * did until this was caught. The document is still recorded and still links to
 * Drive; it just has no text, like the templates and stubs already do.
 */
const NOTHING_TO_EXPORT = /cannotExportFile|exportSizeLimitExceeded/;

/** One Drive export, as text, or empty when Drive will not export the file. */
async function exportFile(fileId: string, mimeType: string): Promise<string> {
    const params = new URLSearchParams({
        mimeType,
        supportsAllDrives: "true",
        key: apiKey(),
    });

    try {
        const response = await driveFetch(
            `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}/export?${params.toString()}`,
        );
        return await response.text();
    } catch (cause) {
        // driveFetch puts Drive's own reason in the message; see above.
        if (cause instanceof Error && NOTHING_TO_EXPORT.test(cause.message)) {
            return "";
        }
        throw cause;
    }
}

/** A markdown table row, which is where the export loses the author's breaks. */
const TABLE_ROW = /^[ \t]*\|/m;

/**
 * Export a Google Doc as markdown, with the line breaks Drive drops put back.
 *
 * Markdown rather than plain text because it preserves the heading and list
 * structure that makes an article or section citable.
 *
 * HTML is fetched as well, but only for documents with a table in them, and
 * only for its structure: a markdown table row is one line, so Drive flattens
 * everything an author put inside a cell onto it, and the minutes template
 * holds whole meetings in cells. See lib/cells.ts. The second export is worth
 * the call because the alternative is storing an hour of discussion as a single
 * line, but it is a repair rather than a requirement -- if it fails, the
 * document is still the document.
 */
export async function exportDocumentAsMarkdown(
    fileId: string,
): Promise<string> {
    // Images are stripped here rather than downstream so that the stored text,
    // the hash, the model input, and the citation offsets all agree on one
    // version of the document.
    const markdown = sanitizeExport(await exportFile(fileId, "text/markdown"));
    if (!TABLE_ROW.test(markdown)) return markdown;

    try {
        return restoreCellBreaks(markdown, await exportFile(fileId, "text/html"));
    } catch {
        return markdown;
    }
}

/**
 * Export a Google Slides deck as plain text.
 *
 * Drive has no markdown export for slides, and the HTML option is a zip.
 * Plain text keeps the words the Senate was shown -- the slate of CSE
 * appointees, the cohort-time briefing -- without pretending the deck had
 * document structure.
 */
export async function exportPresentationAsText(fileId: string): Promise<string> {
    return sanitizeExport(await exportFile(fileId, "text/plain"));
}

/**
 * Export a Google Sheet as CSV (the first tab).
 *
 * Roster and email-list workbooks are the reason this exists for the folder
 * walk; linked sheets are a separate case -- an agenda pointing at an
 * initiative tracksheet is the Senate being asked to look at that sheet.
 */
export async function exportSpreadsheetAsCsv(fileId: string): Promise<string> {
    return (await exportFile(fileId, "text/csv")).replace(/^\uFEFF/, "").trim();
}

/** Stable link back to the original, for "open in Google Docs". */
export function driveViewLink(file: DriveFile): string {
    return (
        file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`
    );
}
