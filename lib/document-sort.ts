/**
 * The orders the document listing can be read in, and how it is paged.
 *
 * Shared by the server, which sorts, and the listing, which offers the choice
 * and asks for the next page, so nothing here may touch the database.
 */

import { updatedDate, type DatedDocument } from "@/lib/dates";

export const DOCUMENT_SORTS = ["relevant", "modified", "dated", "created"] as const;

export type DocumentSort = (typeof DOCUMENT_SORTS)[number];

export const DOCUMENT_SORT_LABELS: Record<DocumentSort, string> = {
    relevant: "Most relevant",
    modified: "Modified",
    dated: "Dated",
    created: "Created",
};

/** Relevance only means something against a typed query. */
export function documentSortsFor(hasQuery: boolean): readonly DocumentSort[] {
    return hasQuery ? DOCUMENT_SORTS : DOCUMENT_SORTS.filter((sort) => sort !== "relevant");
}

/** The order a listing opens in, and so the one its URL leaves unsaid. */
export function defaultDocumentSort(hasQuery: boolean): DocumentSort {
    return hasQuery ? "relevant" : "modified";
}

/** Documents per page. A card is tall, so this is several screens already. */
export const DOCUMENT_PAGE_SIZE = 30;

export function isDocumentSort(value: unknown): value is DocumentSort {
    return typeof value === "string" && (DOCUMENT_SORTS as readonly string[]).includes(value);
}

/**
 * Anything unrecognised reads as the default, so an old link still opens.
 * Relevance without a query has nothing to rank by and reads the same way.
 */
export function parseDocumentSort(value: string | null | undefined, hasQuery: boolean): DocumentSort {
    return isDocumentSort(value) && documentSortsFor(hasQuery).includes(value)
        ? value
        : defaultDocumentSort(hasQuery);
}

/**
 * The date a document is placed by under each order.
 *
 * Modified keeps the fallback the listing has always used (lib/dates.ts), so
 * the default order is unchanged; relevance breaks its ties the same way.
 * Dated and Created are exactly the field
 * named: a document that states no date of its own is not dated, and putting
 * it among the dated ones under its Drive time would be a guess.
 */
function sortDate(document: DatedDocument, sort: DocumentSort): Date | null {
    if (sort === "dated") return document.datedAt;
    if (sort === "created") return document.driveCreatedTime;
    return updatedDate(document);
}

export type SortableDocument = DatedDocument & {
    id: string;
    title: string;
    /** Relevance to the typed query; 0 when there is none. */
    findRank: number;
};

/**
 * Newest first under the chosen order.
 *
 * Most relevant puts title matches above body matches (see
 * lib/document-find.ts) and the newest first among equal matches. A date
 * order ignores relevance: every listed document already matches the query,
 * and a reader who picks one is asking for that order. Undated documents go
 * last. The id is the final tiebreak, so
 * the order is total and a page boundary cannot fall between two documents
 * that could swap places on the next request.
 */
export function compareDocuments(
    left: SortableDocument,
    right: SortableDocument,
    sort: DocumentSort,
): number {
    if (sort === "relevant" && right.findRank !== left.findRank) return right.findRank - left.findRank;

    const a = sortDate(left, sort);
    const b = sortDate(right, sort);
    if (a && b && a.getTime() !== b.getTime()) return b.getTime() - a.getTime();
    if (a && !b) return -1;
    if (b && !a) return 1;

    const byTitle = left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    if (byTitle !== 0) return byTitle;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Where the next page starts.
 *
 * `after` is the last document the reader already has. Starting after it,
 * rather than at a count, means a document synced in above the fold since the
 * last page does not push one the reader has seen onto the next page. The
 * offset is the fallback for when that document has since left the listing,
 * and it steps back a page: a removal above it would otherwise skip a
 * document, and the listing drops the repeats a step back sends.
 */
export type DocumentCursor = { after: string; offset: number };

export function pageOf<T extends { id: string }>(
    sorted: T[],
    cursor: DocumentCursor | null,
    limit: number,
): { items: T[]; next: DocumentCursor | null } {
    let start = 0;
    if (cursor) {
        const index = sorted.findIndex((item) => item.id === cursor.after);
        start = index >= 0 ? index + 1 : Math.max(0, cursor.offset - limit);
    }

    const items = sorted.slice(start, start + limit);
    const end = start + items.length;
    const last = items.at(-1);

    return {
        items,
        next: last && end < sorted.length ? { after: last.id, offset: end } : null,
    };
}
