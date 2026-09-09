import { createHash } from "node:crypto";

import { MASTER_FOLDER_ID, MAX_LINK_ROUNDS, SESSION_NUMBER } from "@/config/sga";
import { matchAccount } from "@/lib/accounts";
import { findQuote } from "@/lib/anchor";
import { bodyForDocument } from "@/lib/bodies";
import { extractContributors } from "@/lib/contributors";
import { extractDocumentLinks, resolveReferences } from "@/lib/links";
import { meetingFor } from "@/lib/meetings";
import {
    pruneStaleAliases,
    resetNameResolverCache,
    resolveAffiliates,
} from "@/lib/names";
import { standardTitles } from "@/lib/titles";
import { isAttendanceSheetName } from "@/lib/attendance";
import { isDirectorySheetName, recordDirectory } from "@/lib/directory";
import { linkedSession } from "@/lib/identity";
import {
    GOOGLE_DOC_MIME,
    GOOGLE_SHEET_MIME,
    GOOGLE_SLIDES_MIME,
    type WalkedFile,
    driveViewLink,
    exportDocumentAsMarkdown,
    exportPresentationAsText,
    exportSpreadsheetAsCsv,
    getFile,
    walkFolder,
} from "@/lib/drive";
import {
    exportSharePointAsText,
    getSharePointFile,
    isSharePointFileId,
} from "@/lib/sharepoint";
import { classifyDocument } from "@/lib/kinds";
import { lineageKeyFor } from "@/lib/lineage";
import { deriveDescription } from "@/lib/markdown";
import { prisma } from "@/lib/prisma";

/**
 * Reconciling the database against the SGA master Drive folder.
 *
 * Safe to run repeatedly: documents are keyed on their Drive file ID, and a
 * document whose content hash is unchanged costs one metadata call and no
 * writes. Only genuinely changed documents trigger a re-export, a new
 * revision, and re-anchoring of the citations that point into them.
 */

function hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

export type SyncSummary = {
    syncRunId: string;
    filesSeen: number;
    documentsCreated: number;
    documentsUpdated: number;
    documentsUnchanged: number;
    /** How many of the written documents belong to a prior session. */
    documentsArchived: number;
    /** Documents reached by following a link rather than by the folder walk. */
    documentsLinkedIn: number;
    annotationsOrphaned: number;
    sectionsInvalidated: number;
    /** People linked to documents by the contributor parser. */
    contributorsLinked: number;
    /** Links between two stored documents. */
    referencesLinked: number;
    /** Meetings where both an agenda and its minutes were found. */
    meetingsPaired: number;
    /** Drive accounts resolved onto a known person. */
    driveAccountsLinked: number;
};

/**
 * Re-locate every citation into a document whose text just changed.
 *
 * Quotes that survive get fresh offsets. Quotes that no longer appear are
 * marked orphaned and the sections citing them are flagged stale, which is the
 * mechanism that makes an amendment visible on the site instead of leaving a
 * confidently wrong summary in place.
 */
export async function reanchorDocument(
    documentId: string,
    content: string,
): Promise<{ orphaned: number; sectionsInvalidated: number }> {
    const annotations = await prisma.documentAnnotation.findMany({
        where: { documentId },
        select: { id: true, content: true, orphanedAt: true },
    });

    const orphanedIds: string[] = [];

    for (const annotation of annotations) {
        const anchor = findQuote(content, annotation.content);

        if (anchor) {
            await prisma.documentAnnotation.update({
                where: { id: annotation.id },
                data: {
                    startOffset: anchor.startOffset,
                    endOffset: anchor.endOffset,
                    orphanedAt: null,
                },
            });
            continue;
        }

        orphanedIds.push(annotation.id);
        if (!annotation.orphanedAt) {
            await prisma.documentAnnotation.update({
                where: { id: annotation.id },
                data: {
                    startOffset: null,
                    endOffset: null,
                    orphanedAt: new Date(),
                },
            });
        }
    }

    if (orphanedIds.length === 0) {
        return { orphaned: 0, sectionsInvalidated: 0 };
    }

    const affected = await prisma.citation.findMany({
        where: { annotationId: { in: orphanedIds } },
        select: { sectionId: true },
        distinct: ["sectionId"],
    });

    const { count } = await prisma.generatedSection.updateMany({
        where: {
            id: { in: affected.map((citation) => citation.sectionId) },
            status: "fresh",
        },
        data: { status: "stale" },
    });

    // A document summary quoting a passage that has just been amended away is
    // wrong in the same way a section is.
    const affectedSummaries = await prisma.documentSummaryCitation.findMany({
        where: { annotationId: { in: orphanedIds } },
        select: { summaryId: true },
        distinct: ["summaryId"],
    });

    await prisma.documentSummary.updateMany({
        where: {
            id: { in: affectedSummaries.map((citation) => citation.summaryId) },
            status: "fresh",
        },
        data: { status: "stale" },
    });

    return { orphaned: orphanedIds.length, sectionsInvalidated: count };
}

/**
 * Re-derive every document's meeting identity.
 *
 * A whole-corpus pass rather than a per-document one so that improving
 * lib/meetings.ts takes effect without a Drive walk. Returns how many meetings
 * ended up with both an agenda and its minutes, which is the number worth
 * watching: it should only ever go up.
 */
export async function recordMeetings(): Promise<{ keyed: number; paired: number }> {
    const documents = await prisma.document.findMany({
        select: {
            id: true,
            title: true,
            folderPath: true,
            sessionNumber: true,
            driveCreatedTime: true,
            meetingKey: true,
            meetingRole: true,
        },
    });

    const roles = new Map<string, Set<string>>();
    let keyed = 0;

    for (const document of documents) {
        const meeting = meetingFor(document);

        if (
            meeting.key !== document.meetingKey ||
            meeting.role !== document.meetingRole
        ) {
            await prisma.document.update({
                where: { id: document.id },
                data: { meetingKey: meeting.key, meetingRole: meeting.role },
            });
        }

        if (!meeting.key) continue;
        keyed += 1;
        const sides = roles.get(meeting.key) ?? new Set<string>();
        sides.add(meeting.role);
        roles.set(meeting.key, sides);
    }

    const paired = [...roles.values()].filter(
        (sides) => sides.has("agenda") && sides.has("minutes"),
    ).length;

    return { keyed, paired };
}

/**
 * Re-derive every document's display title.
 *
 * Corpus-wide because a canonical meeting name is only allowed when no other
 * document would answer to it; see lib/titles.ts.
 */
export async function recordTitles(): Promise<number> {
    const documents = await prisma.document.findMany({
        select: {
            id: true,
            title: true,
            displayTitle: true,
            folderPath: true,
            sessionNumber: true,
            driveCreatedTime: true,
            // A committee that types every meeting of the year into one file
            // can only be recognised from the text; see lib/titles.ts.
            content: true,
        },
    });

    const titles = standardTitles(documents);
    let renamed = 0;

    for (const document of documents) {
        const displayTitle = titles.get(document.id) ?? document.title;

        // The count is of documents the site is showing under a name of its
        // own, not of rows this pass happened to touch: reruns are common and
        // "0 renamed" would read as the rules having stopped working.
        if (displayTitle !== document.title) renamed += 1;
        if (displayTitle === document.displayTitle) continue;

        await prisma.document.update({
            where: { id: document.id },
            data: { displayTitle },
        });
    }

    return renamed;
}

/**
 * Re-derive every document's kind from its filename and folder.
 *
 * Improving classifyDocument should take effect without a Drive walk, the
 * same way improving the meeting keys does. Cheap-path syncs skip the
 * classify call, so without this a bill ingested before "Act" was a kind
 * would stay unknown forever.
 */
export async function recordKinds(): Promise<number> {
    const documents = await prisma.document.findMany({
        select: { id: true, title: true, folderPath: true, kind: true },
    });

    let changed = 0;

    for (const document of documents) {
        const kind = classifyDocument({
            name: document.title,
            folderPath: document.folderPath,
        });
        if (kind === document.kind) continue;

        await prisma.document.update({
            where: { id: document.id },
            data: { kind },
        });
        changed += 1;
    }

    return changed;
}

/**
 * Re-derive the session of documents reached by a link, from what they say
 * about themselves.
 *
 * A linked file inherits a session from the earliest agenda that pointed at
 * it, which is right for a bill that is still being cited years later -- and
 * wrong for a Google Doc that was copied from last session and rewritten.
 * The caption wins: "S.B.26-27" is the 114th, even if a 112th agenda still
 * links the same file id. Files the walk found keep their folder's session.
 */
export async function recordSessions(): Promise<number> {
    const documents = await prisma.document.findMany({
        where: { discoveredVia: "link" },
        select: { id: true, title: true, content: true, sessionNumber: true },
    });

    let changed = 0;

    for (const document of documents) {
        if (document.sessionNumber === null) continue;

        const inferred = linkedSession(
            { title: document.title, content: document.content },
            document.sessionNumber,
        );
        if (inferred === document.sessionNumber) continue;

        await prisma.document.update({
            where: { id: document.id },
            data: { sessionNumber: inferred },
        });
        changed += 1;
    }

    return changed;
}

/**
 * Rebuild the cross-document link graph.
 *
 * Wholesale, because resolution is not stable per document: an agenda linking
 * a bill that had not been ingested yet resolves the moment the bill arrives.
 */
export async function rebuildReferences(): Promise<number> {
    const documents = await prisma.document.findMany({
        select: { id: true, driveFileId: true, content: true },
    });

    const edges = resolveReferences(documents);

    await prisma.$transaction([
        prisma.documentReference.deleteMany({}),
        prisma.documentReference.createMany({ data: edges, skipDuplicates: true }),
    ]);

    return edges.length;
}

/**
 * Link Drive owner and last-editor accounts onto people the archive knows.
 *
 * Runs after every document has been ingested, because the candidate list is
 * built from the people named across the whole archive: a handle that matches
 * nobody early in a sync may match once the roster has been read.
 *
 * Rows are written with source "drive", which `recordContributors` clears, so
 * a later re-parse never leaves a stale guess behind. Manual corrections use
 * source "manual" and are untouched by either.
 */
export async function recordDriveAccounts(): Promise<number> {
    const people = await prisma.hopkinsAffiliate.findMany({
        select: { id: true, name: true },
    });

    const documents = await prisma.document.findMany({
        where: {
            OR: [
                { NOT: { driveOwnerEmail: null } },
                { NOT: { driveLastEditorEmail: null } },
            ],
        },
        select: {
            id: true,
            driveOwnerName: true,
            driveOwnerEmail: true,
            driveLastEditorName: true,
            driveLastEditorEmail: true,
        },
    });

    await prisma.documentContributor.deleteMany({ where: { source: "drive" } });

    let linked = 0;

    for (const document of documents) {
        const accounts = [
            {
                role: "drive_owner",
                email: document.driveOwnerEmail,
                displayName: document.driveOwnerName,
            },
            {
                role: "drive_editor",
                email: document.driveLastEditorEmail,
                displayName: document.driveLastEditorName,
            },
        ];

        for (const account of accounts) {
            if (!account.email) continue;

            const match = matchAccount(account, people);
            if (!match) continue;

            await prisma.documentContributor.upsert({
                where: {
                    documentId_hopkinsAffiliateId_role: {
                        documentId: document.id,
                        hopkinsAffiliateId: match.person.id,
                        role: account.role,
                    },
                },
                create: {
                    documentId: document.id,
                    hopkinsAffiliateId: match.person.id,
                    role: account.role,
                    source: "drive",
                    evidence: match.evidence,
                },
                update: { source: "drive", evidence: match.evidence },
            });
            linked += 1;
        }
    }

    return linked;
}

/**
 * Record who a document names, replacing what the parser previously found.
 *
 * Short forms ("Sumi", "Jazz") are folded onto a regular full-name person
 * when one already exists; see lib/names.ts. Only parser-authored rows are
 * cleared: a `manual` correction outlives every later sync.
 */
export async function recordContributors(
    documentId: string,
    content: string,
): Promise<number> {
    const parsed = extractContributors(content);

    await prisma.documentContributor.deleteMany({
        where: { documentId, source: { in: ["parsed", "drive"] } },
    });

    // A first name means whoever the *document* means, so the resolver is
    // told which meeting this is and gets the text to look full names up in.
    const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: { kind: true, folderPath: true, title: true, sessionNumber: true },
    });

    const affiliateIds = await resolveAffiliates(
        parsed.map((person) => ({ name: person.name, evidence: person.evidence })),
        {
            text: content,
            body: document ? bodyForDocument(document) : null,
            isCurrentSession: document?.sessionNumber === SESSION_NUMBER,
        },
    );

    let linked = 0;

    for (const [index, person] of parsed.entries()) {
        const hopkinsAffiliateId = affiliateIds[index]!;

        await prisma.documentContributor.upsert({
            where: {
                documentId_hopkinsAffiliateId_role: {
                    documentId,
                    hopkinsAffiliateId,
                    role: person.role,
                },
            },
            create: {
                documentId,
                hopkinsAffiliateId,
                role: person.role,
                source: "parsed",
                evidence: person.evidence,
                note: person.note,
            },
            update: {
                source: "parsed",
                evidence: person.evidence,
                note: person.note,
            },
        });
        linked += 1;

        // An office named next to someone ("Jackson Morris (CE Chair)") is a
        // standing role, not a fact about this document, so it lands on the
        // person rather than on the contribution.
        if (person.office) {
            const category = await prisma.hopkinsCategory.upsert({
                where: {
                    type_name: { type: "committee_role", name: person.office },
                },
                create: { type: "committee_role", name: person.office },
                update: {},
                select: { id: true },
            });

            const held = await prisma.hopkinsRelationship.findFirst({
                where: {
                    hopkinsAffiliateId,
                    hopkinsCategoryId: category.id,
                },
                select: { id: true },
            });

            if (!held) {
                await prisma.hopkinsRelationship.create({
                    data: {
                        hopkinsAffiliateId,
                        hopkinsCategoryId: category.id,
                    },
                });
            }
        }
    }

    return linked;
}

type SyncOptions = { trigger?: "cron" | "manual"; force?: boolean };

async function exportIngestible(file: WalkedFile): Promise<string | null> {
    if (isSharePointFileId(file.id)) {
        const sharingUrl = file.webViewLink;
        if (!sharingUrl) return null;
        return exportSharePointAsText(
            {
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                createdTime: file.createdTime,
                modifiedTime: file.modifiedTime,
                webViewLink: sharingUrl,
                ownerName: file.owner?.displayName ?? null,
                lastEditorName: file.lastModifyingUser?.displayName ?? null,
                kind: /spreadsheetml|excel/i.test(file.mimeType) ? "excel" : "word",
            },
            sharingUrl,
        );
    }

    if (file.mimeType === GOOGLE_SHEET_MIME) return exportSpreadsheetAsCsv(file.id);
    if (file.mimeType === GOOGLE_SLIDES_MIME) return exportPresentationAsText(file.id);
    return exportDocumentAsMarkdown(file.id);
}

/**
 * Store one Drive file, exporting it only if its text has actually changed.
 *
 * Shared by the folder walk and the link-follower, which differ only in how
 * they found the file: the walk knows the folder it sits in, and the follower
 * knows the document that pointed at it.
 */
async function ingestFile(
    file: WalkedFile,
    discoveredVia: "walk" | "link",
    options: SyncOptions,
    summary: SyncSummary,
): Promise<boolean> {
    const existing = await prisma.document.findUnique({
        where: { driveFileId: file.id },
        select: { id: true, contentHash: true, driveModifiedTime: true },
    });

    const driveModifiedTime = file.modifiedTime ? new Date(file.modifiedTime) : null;
    const driveCreatedTime = file.createdTime ? new Date(file.createdTime) : null;

    // Cheap path: Drive says the file has not been touched.
    const mtimeUnchanged =
        existing &&
        driveModifiedTime &&
        existing.driveModifiedTime &&
        existing.driveModifiedTime.getTime() === driveModifiedTime.getTime();

    if (mtimeUnchanged && !options.force) {
        await prisma.document.update({
            where: { id: existing.id },
            // createdTime is written even on the cheap path so that adding it
            // to the schema backfills on the next sync, rather than only for
            // documents that happen to change.
            data: { driveCreatedTime, lastSyncedAt: new Date() },
        });
        summary.documentsUnchanged += 1;
        return true;
    }

    const content = await exportIngestible(file);
    // A SharePoint file we cannot flatten is not stored as an empty row.
    if (content === null) return false;

    const contentHash = hashContent(content);

    // Drive bumps modifiedTime for changes that do not alter text, such as a
    // comment or a formatting tweak.
    if (existing && existing.contentHash === contentHash) {
        await prisma.document.update({
            where: { id: existing.id },
            data: { driveCreatedTime, driveModifiedTime, lastSyncedAt: new Date() },
        });
        summary.documentsUnchanged += 1;
        return true;
    }

    const sessionNumber =
        discoveredVia === "link"
            ? linkedSession({ title: file.name, content }, file.sessionNumber)
            : file.sessionNumber;

    const fields = {
        source: driveViewLink(file),
        mimeType: file.mimeType,
        title: file.name,
        description: deriveDescription(content),
        content,
        contentHash,
        kind: classifyDocument({ name: file.name, folderPath: file.folderPath }),
        folderPath: file.folderPath,
        discoveredVia,
        sessionNumber,
        lineageKey: lineageKeyFor(file.name, file.id),
        driveCreatedTime,
        driveModifiedTime,
        lastSyncedAt: new Date(),
        driveOwnerName: file.owner?.displayName ?? null,
        driveOwnerEmail: file.owner?.emailAddress ?? null,
        driveLastEditorName: file.lastModifyingUser?.displayName ?? null,
        driveLastEditorEmail: file.lastModifyingUser?.emailAddress ?? null,
    };

    const document = await prisma.document.upsert({
        where: { driveFileId: file.id },
        create: { driveFileId: file.id, ...fields },
        update: fields,
    });

    await prisma.documentRevision.upsert({
        where: { documentId_contentHash: { documentId: document.id, contentHash } },
        create: {
            documentId: document.id,
            title: file.name,
            content,
            contentHash,
            driveModifiedTime,
        },
        update: { fetchedAt: new Date() },
    });

    summary.contributorsLinked += await recordContributors(document.id, content);

    if (sessionNumber !== SESSION_NUMBER) summary.documentsArchived += 1;

    if (!existing) {
        summary.documentsCreated += 1;
        return true;
    }

    summary.documentsUpdated += 1;
    const reanchored = await reanchorDocument(document.id, content);
    summary.annotationsOrphaned += reanchored.orphaned;
    summary.sectionsInvalidated += reanchored.sectionsInvalidated;

    // The summary restates the whole document, so any change to the text dates
    // it -- not just a change to a quoted passage.
    await prisma.documentSummary.updateMany({
        where: { documentId: document.id, status: "fresh" },
        data: { status: "stale" },
    });
    return true;
}

/**
 * Every file the archive links to but does not hold, the earliest session
 * that links it, and the URL to fetch it with.
 *
 * The inherited session is the fallback. A bill that names its own year
 * ("S.B.26-27") is reassigned at ingest; see `linkedSession`. Earliest is
 * still the right default for a file that says nothing about itself and is
 * still being cited two sessions later.
 */
async function unheldTargets(): Promise<
    Map<string, { sessionNumber: number | null; url: string }>
> {
    const documents = await prisma.document.findMany({
        select: { driveFileId: true, content: true, sessionNumber: true },
    });

    const held = new Set(documents.map((document) => document.driveFileId));
    const targets = new Map<string, { sessionNumber: number | null; url: string }>();

    for (const document of documents) {
        for (const link of extractDocumentLinks(document.content)) {
            if (held.has(link.fileId)) continue;

            const known = targets.get(link.fileId);
            const session = document.sessionNumber;
            if (
                !targets.has(link.fileId) ||
                (session !== null &&
                    (known?.sessionNumber === null ||
                        known?.sessionNumber === undefined ||
                        session < known.sessionNumber))
            ) {
                targets.set(link.fileId, {
                    sessionNumber: session,
                    url: known?.url || link.url,
                });
            }
        }
    }

    return targets;
}

/**
 * What Google Docs makes when somebody exports a document's comment thread.
 *
 * The file is named for the document it discusses and reads like an early
 * draft of it, so "Comments for JHU SGA Constitution April 2026" classifies as
 * a constitution and becomes citable as binding text. It is a margin note.
 */
const COMMENT_EXPORT = /^comments for\b/i;

/**
 * Whether a linked file is a document of record.
 *
 * Docs, sheets and slides -- the three things an SGA agenda actually links.
 * A GBM agenda is a list of those: the bill up for a reading (a Doc), the
 * initiative tracksheet (a Sheet), the slate of CSE appointees (Slides). A
 * linked PDF or .docx has no text export, and a row holding nothing but a
 * filename is a document the reader cannot read.
 *
 * The folder walk still refuses every other sheet; following a link is a
 * different claim. Somebody with a seat put this file in front of the Senate,
 * so it is SGA business even if it lives in its author's Drive.
 */
function worthFollowing(file: { name: string; mimeType: string }): boolean {
    if (COMMENT_EXPORT.test(file.name.trim())) return false;
    return (
        file.mimeType === GOOGLE_DOC_MIME ||
        file.mimeType === GOOGLE_SHEET_MIME ||
        file.mimeType === GOOGLE_SLIDES_MIME
    );
}

/**
 * Ingest the documents the archive links to but does not hold.
 *
 * An SGA agenda is mostly a list of links, and what it links to is the
 * substance of the meeting: the bill up for a second reading, the slate of CSE
 * appointees, the committee's initiative tracker. Almost none of those files
 * are ever filed into the master folder -- they are written wherever their
 * author was working and pasted into the agenda -- so walking the folder
 * collects every agenda and none of the things the agendas are about.
 *
 * So the links get followed. A link out of a document the SGA filed is
 * evidence enough that the target is SGA business: somebody with a seat put it
 * in front of the Senate. Nothing is guessed at, and a file Drive will not
 * serve is simply left where it is.
 */
export async function followLinks(
    options: SyncOptions,
    summary: SyncSummary,
): Promise<number> {
    // Kept across rounds so a file that is private, deleted, or a PDF is asked
    // about once per sync rather than once per round.
    const passedOver = new Set<string>();
    let linkedIn = 0;

    for (let round = 0; round < MAX_LINK_ROUNDS; round += 1) {
        const targets = await unheldTargets();

        let ingestedThisRound = 0;

        for (const [fileId, target] of targets) {
            if (passedOver.has(fileId)) continue;

            const sessionNumber = target.sessionNumber ?? SESSION_NUMBER;

            if (isSharePointFileId(fileId)) {
                const file = await getSharePointFile(target.url);
                if (!file) {
                    passedOver.add(fileId);
                    continue;
                }

                const stored = await ingestFile(
                    {
                        id: file.id,
                        name: file.name,
                        mimeType: file.mimeType,
                        createdTime: file.createdTime,
                        modifiedTime: file.modifiedTime,
                        webViewLink: file.webViewLink || target.url,
                        owner: file.ownerName
                            ? { displayName: file.ownerName, emailAddress: null }
                            : null,
                        lastModifyingUser: file.lastEditorName
                            ? { displayName: file.lastEditorName, emailAddress: null }
                            : null,
                        folderPath: "",
                        sessionNumber,
                    },
                    "link",
                    options,
                    summary,
                );
                if (!stored) {
                    passedOver.add(fileId);
                    continue;
                }
                ingestedThisRound += 1;
                linkedIn += 1;
                continue;
            }

            const driveFile = await getFile(fileId);
            if (!driveFile) {
                passedOver.add(fileId);
                continue;
            }

            if (!worthFollowing(driveFile)) {
                passedOver.add(fileId);
                continue;
            }

            const stored = await ingestFile(
                { ...driveFile, folderPath: "", sessionNumber },
                "link",
                options,
                summary,
            );
            if (!stored) {
                passedOver.add(fileId);
                continue;
            }
            ingestedThisRound += 1;
            linkedIn += 1;
        }

        // Nothing new arrived, so the next round would find the same targets.
        if (ingestedThisRound === 0) break;
    }

    return linkedIn;
}

export async function syncMasterFolder(
    options: SyncOptions = {},
): Promise<SyncSummary> {
    const syncRun = await prisma.syncRun.create({
        data: {
            status: "running",
            masterFolderId: MASTER_FOLDER_ID,
            trigger: options.trigger ?? "manual",
        },
    });

    const summary: SyncSummary = {
        syncRunId: syncRun.id,
        filesSeen: 0,
        documentsCreated: 0,
        documentsUpdated: 0,
        documentsUnchanged: 0,
        documentsArchived: 0,
        documentsLinkedIn: 0,
        annotationsOrphaned: 0,
        sectionsInvalidated: 0,
        contributorsLinked: 0,
        referencesLinked: 0,
        meetingsPaired: 0,
        driveAccountsLinked: 0,
    };

    try {
        const files = await walkFolder(MASTER_FOLDER_ID);

        // A first name is read against who currently holds a seat, so the
        // aliases the archive has outgrown go first and the cached list of
        // people is rebuilt after.
        await pruneStaleAliases();
        resetNameResolverCache();

        // Google Docs, plus the few sheets that say who the SGA is: rosters,
        // email lists, and the attendance workbook, which is the only record
        // of which seat each member holds. Every other sheet stays unexported.
        const docs = files.filter(
            (file) =>
                file.mimeType === GOOGLE_DOC_MIME ||
                (file.mimeType === GOOGLE_SHEET_MIME &&
                    (isDirectorySheetName(file.name) || isAttendanceSheetName(file.name))),
        );
        summary.filesSeen = files.length;

        for (const file of docs) {
            await ingestFile(file, "walk", options, summary);
        }

        // Note: documents removed from Drive are intentionally left in place
        // rather than deleted, so existing citations do not break. They stop
        // having their lastSyncedAt refreshed, which is how to spot them.

        summary.documentsLinkedIn = await followLinks(options, summary);

        await recordDirectory(SESSION_NUMBER);

        // Whole-corpus passes. Each of these needs every document to exist
        // before it can be right, so they run once at the end rather than per
        // document inside the walk.
        await recordSessions();
        summary.meetingsPaired = (await recordMeetings()).paired;
        // Titles depend on the meeting keys the pass above just wrote.
        await recordTitles();
        await recordKinds();
        summary.referencesLinked = await rebuildReferences();
        summary.driveAccountsLinked = await recordDriveAccounts();

        await prisma.syncRun.update({
            where: { id: syncRun.id },
            data: {
                status: "success",
                finishedAt: new Date(),
                filesSeen: summary.filesSeen,
                documentsCreated: summary.documentsCreated,
                documentsUpdated: summary.documentsUpdated,
                documentsUnchanged: summary.documentsUnchanged,
                documentsArchived: summary.documentsArchived,
                annotationsOrphaned: summary.annotationsOrphaned,
                sectionsInvalidated: summary.sectionsInvalidated,
                contributorsLinked: summary.contributorsLinked,
                referencesLinked: summary.referencesLinked,
                meetingsPaired: summary.meetingsPaired,
            },
        });

        return summary;
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        await prisma.syncRun.update({
            where: { id: syncRun.id },
            data: {
                status: "error",
                error: message,
                finishedAt: new Date(),
                filesSeen: summary.filesSeen,
                documentsCreated: summary.documentsCreated,
                documentsUpdated: summary.documentsUpdated,
                documentsUnchanged: summary.documentsUnchanged,
                documentsArchived: summary.documentsArchived,
            },
        });
        throw cause;
    }
}
