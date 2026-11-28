/**
 * The links SGA documents already contain, turned into navigation.
 *
 * An agenda is mostly a list of links: to the bill being read, to the
 * guidelines being adopted, to last meeting's minutes. Those links point at
 * Google Docs or SharePoint sharing URLs, and the file ID inside each one is
 * the same key `sync` reconciles documents on -- so a link whose target has
 * been ingested can be rewritten as a link into this site, and read
 * backwards as "which meetings discussed this bill".
 *
 * Nothing here guesses. A reference exists only when the author actually typed
 * the link and the target is a document we hold.
 */

import {
    sharePointFileId,
    sharePointKind,
} from "@/lib/sharepoint";

/**
 * Drive file IDs are long enough that a shorter match is something else -- a
 * fragment, a tab id -- rather than a document.
 */
const FILE_ID = "[a-zA-Z0-9_-]{16,}";

/** `/d/<id>/edit`, covering docs, sheets, slides and `/u/0/d/` variants. */
const PATH_ID = new RegExp(`/d/(${FILE_ID})`);

/** `drive.google.com/open?id=<id>`. */
const QUERY_ID = new RegExp(`[?&]id=(${FILE_ID})`);

/** A Google URL, stopping before markdown's own punctuation. */
const DRIVE_URL = /https?:\/\/(?:docs|drive)\.google\.com\/[^\s<>)\]"'`]+/g;

/**
 * Drive lives on two hosts and nothing else here is Drive.
 *
 * The `id=` form below is not unique to Google: the Microsoft Forms links the
 * SGA uses for committee placements carry an `id` query parameter too, and
 * reading a Drive file ID out of one invents a document that was never linked.
 */
const DRIVE_HOST = /^https?:\/\/(?:docs|drive)\.google\.com\//i;

/** A SharePoint / OneDrive sharing URL, including the `livejohnshopkins-my` host. */
const SHAREPOINT_URL = /https?:\/\/[^\s<>)\]"'`]*sharepoint\.com\/[^\s<>)\]"'`]+/gi;

/** `[label](url)`, so a reference can be labelled the way the author wrote it. */
// Not after a backslash: Word's "[Link]" around a hyperlink exports as
// `\[[Link](url)\]`, and the escaped bracket is text, not the link's own.
const MARKDOWN_LINK = /(?<!\\)\[([^\]\n]*)\]\(([^)\n]+)\)/g;

export type DriveLink = {
    /** The Drive or SharePoint file ID the link points at. */
    fileId: string;
    /** The author's link text, or "" for a bare URL. */
    text: string;
    /** Where it first appears, so references list in reading order. */
    offset: number;
    /** The URL as typed, for following a target we do not yet hold. */
    url: string;
};

export type DocumentLink = DriveLink & {
    source: "drive" | "sharepoint";
};

/**
 * Google Docs escapes punctuation on export, so the same URL shows up as both
 * `.../1_X1Phk...` and `.../1\_X1Phk...`. Undo that before reading the ID out,
 * or half the links in the archive silently fail to resolve.
 */
function unescapeUrl(url: string): string {
    return url.replace(/\\([^A-Za-z0-9])/g, "$1");
}

export function driveFileIdFrom(url: string): string | null {
    const cleaned = unescapeUrl(url);
    if (!DRIVE_HOST.test(cleaned)) return null;

    // Folder links are deliberately not matched: a folder is never a document.
    return PATH_ID.exec(cleaned)?.[1] ?? QUERY_ID.exec(cleaned)?.[1] ?? null;
}

function sharePointIdFrom(url: string): string | null {
    const cleaned = unescapeUrl(url);
    if (sharePointKind(cleaned) === "folder") return null;
    return sharePointFileId(cleaned);
}

function recordLink(
    byFileId: Map<string, DocumentLink>,
    link: DocumentLink,
): void {
    const existing = byFileId.get(link.fileId);
    if (!existing) {
        byFileId.set(link.fileId, { ...link, text: link.text.trim() });
        return;
    }
    if (!existing.text && link.text.trim()) existing.text = link.text.trim();
}

function linksFrom(
    markdown: string,
    source: "drive" | "sharepoint",
    urlPattern: RegExp,
    idFrom: (url: string) => string | null,
): DocumentLink[] {
    const byFileId = new Map<string, DocumentLink>();

    for (const match of markdown.matchAll(MARKDOWN_LINK)) {
        const url = match[2]!;
        const fileId = idFrom(url);
        if (fileId) {
            recordLink(byFileId, {
                fileId,
                text: match[1]!,
                offset: match.index ?? 0,
                url: unescapeUrl(url),
                source,
            });
        }
    }

    for (const match of markdown.matchAll(urlPattern)) {
        const url = match[0];
        const fileId = idFrom(url);
        if (fileId) {
            recordLink(byFileId, {
                fileId,
                text: "",
                offset: match.index ?? 0,
                url: unescapeUrl(url),
                source,
            });
        }
    }

    return [...byFileId.values()].sort((a, b) => a.offset - b.offset);
}

/**
 * Every distinct Drive document linked from this markdown, in reading order.
 *
 * A target linked several times collapses to one entry, keeping the first
 * position and the first non-empty label -- an agenda that links the same bill
 * from two items is still one reference.
 */
export function extractDriveLinks(markdown: string): DriveLink[] {
    return linksFrom(markdown, "drive", DRIVE_URL, driveFileIdFrom);
}

/**
 * Drive and SharePoint links, in reading order, collapsed per target.
 *
 * SharePoint sharing URLs are a second host the Senate already types: the
 * Treasurer's report lives in OneDrive, not the master folder. Folders are
 * dropped, the same way Drive folder links are.
 */
export function extractDocumentLinks(markdown: string): DocumentLink[] {
    return [
        ...extractDriveLinks(markdown).map((link) => ({
            ...link,
            source: "drive" as const,
        })),
        ...linksFrom(markdown, "sharepoint", SHAREPOINT_URL, sharePointIdFrom),
    ].sort((a, b) => a.offset - b.offset);
}

/** Local archive links use document IDs rather than external storage IDs. */
export function extractInternalDocumentLinks(markdown: string) {
    const links = linksFrom(markdown, "drive",
        /https?:\/\/(?:www\.)?jhusga\.org\/documents\/[^\s<>)\]"'`]+/gi,
        raw => {
            const cleaned = unescapeUrl(raw);
            if (!/^(?:https?:\/\/(?:www\.)?jhusga\.org)?\/documents\//i.test(cleaned)) return null;
            try {
                const url = new URL(cleaned, "https://www.jhusga.org");
                return /^\/documents\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/?$/i.exec(url.pathname)?.[1].toLowerCase() ?? null;
            } catch { return null; }
        });
    return links.map(({ fileId, text, offset, url }) => ({ documentId: fileId, text, offset, url }));
}

export type ReferenceEdge = {
    fromDocumentId: string;
    toDocumentId: string;
    ordinal: number;
    anchorText: string;
};

/**
 * Resolve every document's links against the set of documents we hold.
 *
 * Whole-corpus rather than per-document because resolution is not stable in
 * isolation: an agenda linking a bill that has not been ingested yet has a
 * dangling link, and that same link resolves the moment the bill appears. A
 * full rebuild each sync is cheap and always correct.
 *
 * Self-links are dropped. Minutes routinely link to their own Drive file, and
 * "this document references itself" is noise.
 */
export function resolveReferences(
    documents: { id: string; driveFileId: string; content: string }[],
): ReferenceEdge[] {
    const byFileId = new Map(documents.map((document) => [document.driveFileId, document.id]));
    const ids = new Set(documents.map(document => document.id));
    const edges: ReferenceEdge[] = [];

    for (const document of documents) {
        let ordinal = 0;
        const targets = [
            ...extractDocumentLinks(document.content).map(link => ({ ...link, target: byFileId.get(link.fileId) })),
            ...extractInternalDocumentLinks(document.content).map(link => ({ ...link, target: ids.has(link.documentId) ? link.documentId : undefined })),
        ].sort((a, b) => a.offset - b.offset);
        const seen = new Set<string>();
        for (const link of targets) {
            const toDocumentId = link.target;
            if (!toDocumentId || toDocumentId === document.id) continue;
            if (seen.has(toDocumentId)) continue;
            seen.add(toDocumentId);

            edges.push({
                fromDocumentId: document.id,
                toDocumentId,
                ordinal,
                anchorText: link.text.slice(0, 300),
            });
            ordinal += 1;
        }
    }

    return edges;
}
