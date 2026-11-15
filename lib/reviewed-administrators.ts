import type { Prisma } from "@prisma/client";
import { sessionEndDate, sessionStartDate } from "@/config/session";
import { prisma } from "@/lib/prisma";

/**
 * Credits for the staff in the ReviewedAdministrator table.
 *
 * The parser cannot say who "Dean Wilson" is: that depends on who held the
 * title when the document was written, which no document states. The roster
 * is a maintainer's answer, checked against official sources, so it lives in a
 * table nothing derives. The credits it implies are derived, though -- written
 * with source "reviewed" by recordContributors and replaced on every pass --
 * so correcting the roster corrects the archive on the next reprocess.
 */

export const REVIEWED_SOURCE = "reviewed";

export type RosterForm = { text: string; validFrom: Date | null; validTo: Date | null };
export type RosterEntry = { hopkinsAffiliateId: string; title: string; source: string; forms: RosterForm[] };
export type MentionedDocument = {
    title: string;
    content: string;
    kind?: string | null;
    datedAt?: Date | null;
    sessionNumber?: number | null;
};
export type ReviewedMention = { hopkinsAffiliateId: string; evidence: string; note: string };

const DAY = 24 * 60 * 60 * 1000;
const EVIDENCE_LENGTH = 300;

/** When the document is from; an undated one spans its whole session. */
function documentSpan(document: MentionedDocument): [Date, Date] | null {
    if (document.datedAt) return [document.datedAt, document.datedAt];
    if (document.sessionNumber) {
        return [sessionStartDate(document.sessionNumber), new Date(sessionEndDate(document.sessionNumber).getTime() - 1)];
    }
    return null;
}

function usable(form: RosterForm, span: [Date, Date] | null): boolean {
    if (!form.validFrom && !form.validTo) return true;
    if (!span) return false;
    if (form.validFrom && span[0] < form.validFrom) return false;
    if (form.validTo && span[1].getTime() >= form.validTo.getTime() + DAY) return false;
    return true;
}

function formPattern(text: string): RegExp {
    return new RegExp(`(?<!\\p{L})${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "u");
}

export function reviewedNote(entry: Pick<RosterEntry, "title" | "source">): string {
    return `Reviewed identity: ${entry.title}. Source: ${entry.source}. Named in the text; this does not establish attendance or a speaking turn.`;
}

/**
 * The roster members a document writes, each with the first line that does.
 * People the document already credits in any role are left to that credit.
 */
export function findReviewedMentions(
    document: MentionedDocument,
    roster: RosterEntry[],
    alreadyCredited: ReadonlySet<string> = new Set(),
): ReviewedMention[] {
    // Articles are the News-Letter's reporting, not the SGA's own record.
    if (document.kind === "newsletter.article") return [];

    const span = documentSpan(document);
    const lines = [document.title, ...document.content.split(/\r?\n|\v/)];
    const mentions: ReviewedMention[] = [];

    for (const entry of roster) {
        if (alreadyCredited.has(entry.hopkinsAffiliateId)) continue;
        const patterns = entry.forms.filter(form => usable(form, span)).map(form => formPattern(form.text));
        if (patterns.length === 0) continue;

        for (const line of lines) {
            const match = patterns.map(pattern => pattern.exec(line)).find(Boolean);
            if (!match) continue;
            const text = line.trim();
            const start = Math.max(0, text.indexOf(match[0]) - 120);
            mentions.push({
                hopkinsAffiliateId: entry.hopkinsAffiliateId,
                evidence: text.length <= EVIDENCE_LENGTH ? text : text.slice(start, start + EVIDENCE_LENGTH).trim(),
                note: reviewedNote(entry),
            });
            break;
        }
    }
    return mentions;
}

// A sync or reprocess reads the roster once per document; a long-lived server
// still sees an edit within the minute.
let cached: { at: number; roster: Promise<RosterEntry[]> } | null = null;
const CACHE_MS = 60_000;

export function loadReviewedRoster(): Promise<RosterEntry[]> {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.roster;
    const roster = prisma.reviewedAdministrator.findMany({
        select: {
            hopkinsAffiliateId: true, title: true, source: true,
            forms: { select: { text: true, validFrom: true, validTo: true } },
        },
    });
    cached = { at: Date.now(), roster };
    roster.catch(() => { cached = null; });
    return roster;
}

export function resetReviewedRosterCache(): void {
    cached = null;
}

/**
 * Carry a roster entry from a person being folded away onto the one kept.
 * Both entries' forms survive; the kept person's title and source win.
 */
export async function foldReviewedAdministrator(
    tx: Prisma.TransactionClient,
    fromId: string,
    intoId: string,
): Promise<void> {
    const [from, into] = await Promise.all([fromId, intoId].map(hopkinsAffiliateId =>
        tx.reviewedAdministrator.findUnique({ where: { hopkinsAffiliateId }, select: { id: true } })));
    if (!from) return;
    if (!into) {
        await tx.reviewedAdministrator.update({ where: { id: from.id }, data: { hopkinsAffiliateId: intoId } });
    } else {
        await tx.reviewedAdministratorForm.updateMany({ where: { administratorId: from.id }, data: { administratorId: into.id } });
        await tx.reviewedAdministrator.delete({ where: { id: from.id } });
    }
    resetReviewedRosterCache();
}
