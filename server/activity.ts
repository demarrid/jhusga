import { unstable_cache } from "next/cache";
import { ARCHIVE_CACHE_TAG, ARCHIVE_CACHE_SECONDS } from "@/lib/archive-cache";
import { billVoteDecision, readBillVotingRecords, PREFERRED_VOTING_RECORD_FILE } from "@/lib/bill-votes";
import { CONFIRMED_BILL_PASSAGE, CONFIRMED_RESOLUTION_PASSAGE, REVIEWED_PASSAGE_EVIDENCE } from "@/config/passage-evidence";
import { LEGISLATION_EDITIONS } from "@/config/legislation-editions";
import { getContactDirectory } from "@/server/contact";
import { SESSION_NUMBER } from "@/config/session";
import { demoModeEnabled } from "@/lib/data-mode";
import { formatDateShort } from "@/lib/dates";
import { proseLine } from "@/lib/cite";
import {
    ACTIVITY_CARD_LIMIT,
    ACTIVITY_LANE_ORDER,
    activityDate,
    latestMinutesEntry,
    latestMinutesSummary,
    authorLine,
    contactCredit,
    collectiveResolutionAuthor,
    isHomepageHighlight,
    chooseMeetings,
    countsAsOccurredMeeting,
    countsAsSenateRecord,
    hasOccurred,
    legislationLane,
    passedLegislation,
    recordedResolutionPassage,
    type ActivityCard,
    type ActivityLane,
    type ActivityLaneId,
} from "@/lib/activity";
import { editorDisplayName, rankedEditors } from "@/lib/editors";
import { demoDocuments } from "@/lib/demo-data";
import { findQuote } from "@/lib/anchor";
import { prisma } from "@/lib/prisma";

/**
 * The three lanes of the home carousel.
 *
 * Bills use explicit passage results in the archived voting records first,
 * then Senate minutes when that sheet has no conclusive result. A held source
 * edit does not withdraw the last published document: its checked text remains
 * eligible, while heldRevision content is never used here.
 * Meetings are minutes of meetings whose date has arrived. The current
 * session is read first only because its dates are the latest: a lane with
 * fewer than three cards keeps going into earlier sessions until it has
 * three, or the archive runs out. Resolutions require verified passage and
 * always carry the "Resolution" label. Empty lanes are left out.
 */
// Keep the clock inside the cache miss: a Date argument would create a new
// cache key on every request. Explicit dates remain useful for archive previews.
const cachedRecentActivity = unstable_cache(
    () => loadRecentActivity(new Date()),
    ["recent-activity-v4"],
    { tags: [ARCHIVE_CACHE_TAG], revalidate: ARCHIVE_CACHE_SECONDS },
);

export async function getRecentActivity(now?: Date): Promise<ActivityLane[]> {
    if (demoModeEnabled()) return demoActivity(now ?? new Date());
    const result = now ? await loadRecentActivity(now) : await cachedRecentActivity();
    // Run directory caching outside the activity cache: Next bypasses nested
    // unstable_cache reads. Clone before enriching the cached base cards.
    const lanes = structuredClone(result.lanes);
    await attachPositions(lanes, result.sessions);
    return lanes;
}

type CreditSession = { id: string; sessionNumber: number | null };

async function loadRecentActivity(now: Date): Promise<{ lanes: ActivityLane[]; sessions: CreditSession[] }> {

    const minutes = await prisma.document.findMany({
        where: {
            meetingRole: "minutes",
            kind: { startsWith: "minutes." },
            reviewState: { in: ["published", "held"] },
        },
        select: {
            id: true,
            driveFileId: true,
            title: true,
            displayTitle: true,
            kind: true,
            folderPath: true,
            meetingKey: true,
            meetingRole: true,
            datedAt: true,
            driveCreatedTime: true,
            content: true,
            sessionNumber: true,
            driveLastEditorName: true,
            driveLastEditorEmail: true,
            driveOwnerName: true,
            driveOwnerEmail: true,
            summary: { select: { content: true, status: true } },
        },
    });

    const senateText = minutes.filter(countsAsSenateRecord);
    const textById = new Map(senateText.map((document) => [document.id, document]));

    const passedOn = new Map<string, Date>();

    for (const document of minutes) {
        if (!countsAsSenateRecord(document)) continue;
        const when = activityDate(document);
        if (!when || !hasOccurred(when, now)) continue;

        const text = textById.get(document.id);
        if (!text) continue;

        for (const item of passedLegislation(text.content)) {
            if (item.fileId === text.driveFileId) continue;
            const earlier = passedOn.get(item.fileId);
            if (!earlier || when > earlier) passedOn.set(item.fileId, when);
        }
    }

    // Reviewed mappings recover passage where historical PDFs lost links.
    // Re-verify the cited text on every read so edits cannot leave stale proof.
    for (const evidence of REVIEWED_PASSAGE_EVIDENCE) {
        const text = senateText.find(document => document.driveFileId === evidence.minutesFileId);
        const minutesRecord = text ? minutes.find(document => document.id === text.id) : undefined;
        const when = minutesRecord ? activityDate(minutesRecord) : null;
        if (text && when && hasOccurred(when, now) && findQuote(text.content, evidence.quote)) {
            passedOn.set(evidence.legislationFileId, when);
        }
    }

    const votingSources = await prisma.document.findMany({
        where: {reviewState: {in: ["published", "held"]}, OR: [{driveFileId: PREFERRED_VOTING_RECORD_FILE}, {title: {contains: "Bill Voting Records", mode: "insensitive"}}]},
        select: {content: true, sessionNumber: true},
    });
    const votingRecords = votingSources.map(source => ({session: source.sessionNumber, records: readBillVotingRecords(source.content)}));
    const legislation = await prisma.document.findMany({
        where: {reviewState: {in: ["published", "held"]}, OR: [{kind: {startsWith: "bill."}}, {kind: "resolution"}]},
        select: {id: true, driveFileId: true, title: true, displayTitle: true, kind: true,
            content: true, datedAt: true, sessionNumber: true, summary: {select: {content: true, status: true}}},
    });
    const undatedPassage = new Set<string>();
    for (const confirmation of CONFIRMED_BILL_PASSAGE) {
        const when = new Date(`${confirmation.passedOn}T12:00:00Z`);
        if (hasOccurred(when, now)) passedOn.set(confirmation.legislationFileId, when);
    }
    for (const confirmation of CONFIRMED_RESOLUTION_PASSAGE) {
        const when = new Date(`${confirmation.passedOn}T12:00:00Z`);
        const resolution = legislation.find(document => document.driveFileId === confirmation.legislationFileId);
        if (resolution?.kind === "resolution" && when && hasOccurred(when, now)) {
            passedOn.set(resolution.driveFileId, when);
        }
    }
    for (const document of legislation) {
        if (document.kind === "resolution" && document.datedAt && hasOccurred(document.datedAt, now)
            && recordedResolutionPassage(document.content)) {
            passedOn.set(document.driveFileId, document.datedAt);
        }
        const decision = billVoteDecision(document, votingRecords.filter(source => source.session === document.sessionNumber).flatMap(source => source.records));
        if (decision.status === "not_passed" || decision.status === "ambiguous") passedOn.delete(document.driveFileId);
        if (decision.status === "passed") {
            const when = decision.when ?? passedOn.get(document.driveFileId);
            if (when && hasOccurred(when, now)) passedOn.set(document.driveFileId, when);
            else if (!when && document.datedAt && hasOccurred(document.datedAt, now)) {
                // The sheet verifies adoption but does not date it. Use the
                // document's date for ordering without claiming it as the vote date.
                passedOn.set(document.driveFileId, document.datedAt);
                undatedPassage.add(document.driveFileId);
            }
        }
    }

    const grouped: Record<ActivityLaneId, { card: ActivityCard; when: number }[]> = {
        resolutions: [],
        meetings: [],
        bills: [],
    };

    for (const document of legislation) {
        if (!isHomepageHighlight(document.driveFileId)) continue;
        // Prefer the adopted copy once its published vote line is verified.
        if (LEGISLATION_EDITIONS.some(edition => edition.draftFileId === document.driveFileId
            && legislation.some(copy => copy.driveFileId === edition.finalFileId
                && passedOn.has(copy.driveFileId) && findQuote(copy.content, edition.passageQuote)))) continue;
        const lane = legislationLane({
            title: document.displayTitle || document.title,
            kind: document.kind,
            content: document.content,
        });
        if (!lane) continue;

        const when = passedOn.get(document.driveFileId);
        if (!when) continue;

        const laneId = lane === "resolution" ? "resolutions" : "bills";
        const card = toCard(document, when, laneId === "resolutions" ? "Resolution" : "Passed");
        if (undatedPassage.has(document.driveFileId)) card.dateLabel = "";
        grouped[laneId].push({when: when.getTime(), card});
    }

    const held = chooseMeetings(
        minutes.flatMap((document) => {
            if (!countsAsOccurredMeeting(document)) return [];
            const entry = latestMinutesEntry(document, now);
            const when = entry?.when ?? activityDate(document);
            if (!when || !hasOccurred(when, now)) return [];
            return [
                {
                    ...document,
                    title: document.displayTitle || document.title,
                    when: when.getTime(),
                    entry,
                },
            ];
        }),
        ACTIVITY_CARD_LIMIT,
    );

    grouped.meetings = held.map((document) => ({
        when: document.when,
        card: {
            ...toCard(document, new Date(document.when), "Minutes"),
            ...(document.entry ? {
                href: `/documents/${document.id}#${document.entry.sectionId}`,
                summary: latestMinutesSummary(document.summary),
            } : {}),
        },
    }));

    const lanes = ACTIVITY_LANE_ORDER.flatMap((lane) => {
        const cards = grouped[lane.id]
            .sort((left, right) => right.when - left.when || left.card.title.localeCompare(right.card.title))
            .slice(0, ACTIVITY_CARD_LIMIT)
            .map((entry) => entry.card);

        return cards.length ? [{ ...lane, cards }] : [];
    });

    const sessions = await attachAuthors(lanes);
    return { lanes, sessions };
}

/**
 * The opening sentence of a summary.
 *
 * The rest of a restatement is how the document moved through readings, which
 * on this carousel fights the "Passed" label: the bill page can carry the
 * procedure, and the card only has to say what it is.
 */
function shownSummary(summary: { content: string; status: string } | null): string {
    if (!summary || (summary.status !== "fresh" && summary.status !== "stale")) return "";

    const line = proseLine(summary.content, 500);
    const breakAt = line.search(/\.\s/);
    const sentence = breakAt === -1 ? line : line.slice(0, breakAt + 1);
    if (sentence.length <= 220) return sentence;
    return `${sentence.slice(0, 219).trimEnd()}…`;
}

function toCard(
    document: {
        id: string;
        title: string;
        displayTitle?: string;
        summary: { content: string; status: string } | null;
    },
    when: Date,
    status: string,
    authors = "",
): ActivityCard {
    return {
        id: document.id,
        href: `/documents/${document.id}`,
        title: document.displayTitle || document.title,
        dateLabel: formatDateShort(when) ?? "",
        summary: shownSummary(document.summary),
        authors,
        status,
    };
}

/**
 * Legislation is credited from the lines the bill itself writes. Minutes are
 * credited from substantive writing in retained OAuth revision snapshots.
 * Unknown history and unresolved handles earn no inferred authorship.
 */
async function attachAuthors(
    lanes: ActivityLane[],
): Promise<CreditSession[]> {
    const legislationIds = lanes
        .filter((lane) => lane.id !== "meetings")
        .flatMap((lane) => lane.cards.map((card) => card.id));
    const meetingIds = lanes
        .filter((lane) => lane.id === "meetings")
        .flatMap((lane) => lane.cards.map((card) => card.id));

    const [contributors, revisions, people] = await Promise.all([
        legislationIds.length
            ? prisma.documentContributor.findMany({
                  where: {
                      documentId: { in: legislationIds },
                      role: { in: ["introducer", "author", "sponsor"] },
                  },
                  select: {
                      documentId: true,
                      role: true,
                      hopkinsAffiliate: { select: { name: true } },
                  },
              })
            : [],
        meetingIds.length
            ? prisma.driveRevision.findMany({
                  where: {
                      documentId: { in: meetingIds },
                  },
                  select: {
                      documentId: true,
                      editorName: true,
                      editorEmail: true,
                      modifiedAt: true,
                      revisionId: true,
                      content: true,
                      document: { select: {
                          contentHash: true,
                          driveModifiedTime: true,
                          revisions: { select: { contentHash: true, driveModifiedTime: true } },
                      } },
                  },
              })
            : [],
        prisma.hopkinsAffiliate.findMany({ select: { id: true, name: true } }),
    ]);

    const byDocument = new Map<string, { role: string; name: string }[]>();
    for (const contributor of contributors) {
        const list = byDocument.get(contributor.documentId) ?? [];
        list.push({ role: contributor.role, name: contributor.hopkinsAffiliate.name });
        byDocument.set(contributor.documentId, list);
    }

    // Exclude later Drive edits that the archive has not published (including
    // rejected edits and historical snapshots after a published rollback).
    const publishedRevisions = revisions.filter(revision => {
        const document = revision.document;
        const cutoff = document.revisions.find(stored => stored.contentHash === document.contentHash)
            ?.driveModifiedTime ?? document.driveModifiedTime;
        return cutoff !== null && revision.modifiedAt <= cutoff;
    });
    const authors = rankedEditors(publishedRevisions.map(revision => ({
        ...revision, fetchedAt: revision.modifiedAt,
    })));

    for (const lane of lanes) {
        for (const card of lane.cards) {
            if (lane.id === "meetings") {
                card.authors = [...new Set((authors.get(card.id) ?? [])
                    .map(editor => editorDisplayName(editor, people)).filter(Boolean))].join(", ") || "Writing credit not verified";
            } else {
                card.authors = authorLine(byDocument.get(card.id) ?? []);
            }
        }
    }

    const resolutionsWithoutCredits = lanes.filter(lane => lane.id === "resolutions")
        .flatMap(lane => lane.cards).filter(card => !card.authors);
    if (resolutionsWithoutCredits.length) {
        const records = await prisma.document.findMany({
            where: {id: {in: resolutionsWithoutCredits.map(card => card.id)}},
            select: {id: true, content: true},
        });
        for (const record of records) {
            const card = resolutionsWithoutCredits.find(card => card.id === record.id);
            if (card) card.authors = collectiveResolutionAuthor(record.content);
        }
    }

    // Without qualifying writing history, fall back to the resolved owner.
    const missingCredits = lanes.filter(lane => lane.id === "meetings")
        .flatMap(lane => lane.cards).filter(card => card.authors === "Writing credit not verified");
    if (missingCredits.length) {
        const records = await prisma.document.findMany({
            where: { id: {in: missingCredits.map(card => card.id)} },
            select: {id: true, driveOwnerName: true, driveOwnerEmail: true},
        });
        for (const record of records) {
            const owner = editorDisplayName({name: record.driveOwnerName ?? "", email: record.driveOwnerEmail ?? ""}, people);
            const card = missingCredits.find(card => card.id === record.id);
            if (card && owner) card.authors = owner;
        }
    }

    // Resolve offices against the document's session. The browser measures
    // expanded multi-person credits before choosing whether to display them.
    const credited = lanes.flatMap(lane => lane.cards)
        .filter(card => card.authors
            && card.authors !== "Writing credit not verified");
    if (!credited.length) return [];
    return prisma.document.findMany({
        where: { id: { in: credited.map(card => card.id) } },
        select: { id: true, sessionNumber: true },
    });
}

async function attachPositions(lanes: ActivityLane[], sessions: CreditSession[]): Promise<void> {
    const credited = lanes.flatMap(lane => lane.cards)
        .filter(card => card.authors && card.authors !== "Writing credit not verified");
    const sessionById = new Map(sessions.map(document => [document.id, document.sessionNumber]));
    const directories = await Promise.all([...new Set(sessions.map(document => document.sessionNumber))]
        .filter((session): session is number => session !== null)
        .map(async session => [session, await getContactDirectory(session)] as const));
    const directoryBySession = new Map(directories);
    for (const card of credited) {
        const session = sessionById.get(card.id);
        if (session == null) continue;
        const names = card.authors.split(", ");
        const credits = names.map(name => contactCredit(name, directoryBySession.get(session)?.members ?? []));
        card.authors = credits.map(credit => credit.name).join(", ");
        const expanded = credits.map(credit => credit.full).join("; ");
        if (expanded !== card.authors) card.authorsWithPositions = expanded;
    }

}

function demoActivity(now: Date): ActivityLane[] {
    const meetings = chooseMeetings(
        demoDocuments({ session: SESSION_NUMBER }).flatMap((document) => {
            if (!document.kind.startsWith("minutes.")) return [];
            const when = activityDate({
                title: document.driveTitle,
                displayTitle: document.title,
                datedAt: document.datedAt,
            });
            if (!when || !hasOccurred(when, now)) return [];

            return [
                {
                    meetingKey: document.id,
                    folderPath: document.folderPath,
                    title: document.title,
                    when: when.getTime(),
                    document,
                },
            ];
        }),
        ACTIVITY_CARD_LIMIT,
    );

    const cards = meetings.map((entry) =>
        toCard(
            {
                id: entry.document.id,
                title: entry.document.title,
                summary: entry.document.summary
                    ? { content: entry.document.summary, status: "fresh" }
                    : null,
            },
            new Date(entry.when),
            "Minutes",
        ),
    );

    return cards.length ? [{ id: "meetings", label: "Meetings", cards }] : [];
}
