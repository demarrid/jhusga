/**
 * Which copy of the constitution and bylaws is in force.
 *
 * The Guiding Documents folder rarely holds just one of each. Beside the
 * adopted text sit the edition it replaced ("Previous Revisions"), the copy a
 * bill was drafted against ("Template Bills"), and a working copy somebody is
 * marking up ("Edited (Sep) ... Bylaws"). Several share a filename, and the
 * marked-up ones are the most recently modified, so neither the title nor
 * Drive's timestamps can say which one was adopted.
 *
 * What does say it is the edition date: the date the document records it was
 * ratified or amended, or the month its filename names. Of the copies that are
 * not drafts or set aside, the one with the latest edition date is in force.
 */

import { documentEdition } from "@/lib/titles";
import { governingLineageKey } from "@/lib/lineage";

export type EditionCandidate = {
    id: string;
    title: string;
    kind: string;
    folderPath: string;
    /** The date the document states, from lib/identity.ts. */
    datedAt: Date | null;
    driveModifiedTime: Date | null;
};

/** Kinds where exactly one edition per instrument is in force. */
const EDITION_KINDS = new Set(["guiding.constitution", "guiding.bylaws"]);

/** Filenames of copies that were never adopted as they stand. */
const UNADOPTED_TITLE =
    /\b(?:drafts?|proposed|proposals?|comments?|edited|edits|working|redline[sd]?|suggest(?:ed|ions)?)\b|\bcopy of\b/i;

/** Folders that hold a copy kept for reference rather than in force. */
const SET_ASIDE_FOLDER =
    /^(?:previous revisions?|old(?: versions?)?|archived?|superseded|drafts?|templates?|template bills)$/i;

export function isSetAside(candidate: Pick<EditionCandidate, "title" | "folderPath">): boolean {
    if (UNADOPTED_TITLE.test(candidate.title)) return true;
    return candidate.folderPath
        .split("/")
        .some((segment) => SET_ASIDE_FOLDER.test(segment.trim()));
}

/** When this edition was adopted, as best the document says. */
export function editionDate(candidate: Pick<EditionCandidate, "title" | "datedAt">): Date | null {
    if (candidate.datedAt) return candidate.datedAt;

    // "April 2026" or "Fall 2026", from the filename.
    const [name, year] = documentEdition(candidate.title)?.split(" ") ?? [];
    if (!name || !year) return null;
    const month = MONTHS.indexOf(name) >= 0 ? MONTHS.indexOf(name) : SEASON_MONTHS[name];
    if (month === undefined) return null;
    return new Date(Date.UTC(Number(year), month, 1, 12));
}

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

/** The month a season's edition is dated to, zero-based. */
const SEASON_MONTHS: Record<string, number> = { Spring: 0, Summer: 4, Fall: 7, Winter: 11 };

function time(date: Date | null): number {
    return date?.getTime() ?? Number.NEGATIVE_INFINITY;
}

/** Positive when `left` is the better claim to being in force. */
function compareEditions(left: EditionCandidate, right: EditionCandidate): number {
    const byEdition = time(editionDate(left)) - time(editionDate(right));
    if (byEdition !== 0) return byEdition;
    const byModified = time(left.driveModifiedTime) - time(right.driveModifiedTime);
    if (byModified !== 0) return byModified;
    return right.title.localeCompare(left.title);
}

/**
 * Keep one edition of each constitution and of the bylaws; everything else
 * passes through untouched.
 *
 * Instruments are told apart by lineage, so the CSE's constitution is not
 * mistaken for an older edition of the SGA's. A lineage whose every copy is
 * set aside still keeps its newest, so a misfiled constitution is not lost.
 */
export function currentEditions<T extends EditionCandidate>(documents: readonly T[]): T[] {
    const best = new Map<string, T>();

    for (const document of documents) {
        if (!EDITION_KINDS.has(document.kind)) continue;
        const lineage = governingLineageKey(document.kind, document.title) ?? document.kind;
        const current = best.get(lineage);
        if (!current) {
            best.set(lineage, document);
            continue;
        }
        const setAside = isSetAside(document);
        if (setAside !== isSetAside(current)) {
            if (!setAside) best.set(lineage, document);
            continue;
        }
        if (compareEditions(document, current) > 0) best.set(lineage, document);
    }

    const kept = new Set(best.values());
    return documents.filter(
        (document) => !EDITION_KINDS.has(document.kind) || kept.has(document),
    );
}
