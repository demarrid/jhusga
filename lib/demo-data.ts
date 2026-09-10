import site from "@/demo-data/site.json";
import { FORUM_CATEGORIES } from "@/config/forum";
import { SESSION_NUMBER } from "@/config/session";
import { isComparableKind, isDocumentKind, type DocumentKind } from "@/lib/kinds";
import { renderDocument } from "@/lib/render";
import type { SearchScope } from "@/config/search";
import { collapseUnchanged, diffLines } from "@/lib/diff";

type RawDocument = (typeof site.documents)[number];

const date = (value: string | null | undefined) => value ? new Date(value) : null;

function documentKind(value: string): DocumentKind {
    return isDocumentKind(value) ? value : "unknown";
}

/** Return demo documents with the same shape and filtering as the database listing. */
export function demoDocuments(filters: {
    kind?: string;
    query?: string;
    session?: number | "all";
    personId?: string;
    role?: string;
    officeId?: string;
} = {}) {
    const query = filters.query?.trim().toLowerCase();
    const officePersonId = filters.officeId ? officeHolder(filters.officeId) : undefined;

    return site.documents
        .filter((document) => filters.session === "all" || document.sessionNumber === (filters.session ?? SESSION_NUMBER))
        .filter((document) => !filters.kind || document.kind === filters.kind)
        .filter((document) => !filters.personId || document.contributors.some((person) => person.id === filters.personId))
        .filter((document) => !filters.role || document.contributors.some((person) => person.role === filters.role))
        .filter((document) => !filters.officeId || document.contributors.some((person) => person.id === officePersonId))
        .filter((document) => !query || `${document.title} ${document.description} ${document.content} ${document.contributors.map((person) => person.name).join(" ")}`.toLowerCase().includes(query))
        .map(toListing);
}

function officeHolder(officeId: string): string | undefined {
    return {
        "demo-office-president": "demo-maya",
        "demo-office-senate-president": "demo-jordan",
        "demo-office-senator": "demo-aisha",
    }[officeId];
}

function toListing(document: RawDocument) {
    return {
        id: document.id,
        title: document.title,
        driveTitle: document.driveTitle,
        description: document.description,
        kind: documentKind(document.kind),
        folderPath: document.folderPath,
        discoveredVia: document.discoveredVia,
        source: document.source,
        sessionNumber: document.sessionNumber,
        driveCreatedTime: date(document.driveCreatedTime),
        driveModifiedTime: date(document.driveModifiedTime),
        datedAt: date(document.driveCreatedTime),
        contributors: document.contributors.map(({ id, name, role }) => ({ id, name, role })),
    };
}

/** Build a complete document view, including summary citation highlights. */
export function demoDocument(documentId: string) {
    const document = site.documents.find((entry) => entry.id === documentId);
    if (!document) return null;

    const summaryAnnotations = document.summaryQuotes.map((quote, index) => {
        const startOffset = document.content.indexOf(quote);
        return { id: `${document.id}-citation-${index + 1}`, startOffset, endOffset: startOffset + quote.length };
    });
    // People links use the same highlighted-source behavior as generated prose.
    const personAnnotations = document.contributors
        .filter((person) => document.content.includes(person.evidence))
        .map((person) => {
            const startOffset = document.content.indexOf(person.evidence);
            return { id: `${document.id}-person-${person.id}`, startOffset, endOffset: startOffset + person.evidence.length };
        });
    const annotations = [...summaryAnnotations, ...personAnnotations];

    return {
        ...toListing(document),
        content: document.content,
        isCurrentSession: document.sessionNumber === SESSION_NUMBER,
        lineageKey: document.lineageKey,
        lastSyncedAt: date(document.driveModifiedTime),
        revisionCount: 2,
        meetingRole: document.kind.startsWith("minutes.") ? "minutes" as const : null,
        counterpart: null,
        references: [],
        referencedBy: [],
        unresolvedLinks: [],
        restatement: {
            content: document.summary,
            status: "fresh" as const,
            generatedAt: date(document.driveModifiedTime),
            citations: document.summaryQuotes.map((quote, index) => ({
                annotationId: summaryAnnotations[index]!.id,
                quote,
                href: `#annotation-${summaryAnnotations[index]!.id}`,
                orphaned: false,
            })),
        },
        blocks: renderDocument(document.content, annotations),
        contributors: document.contributors,
        driveOwnerName: "SGA Communications",
        driveLastEditorName: "Demo editor",
        heldNotice: null,
        anyoneCanEdit: false,
    };
}

export function demoPeople(session: number | "all" = SESSION_NUMBER) {
    const documents = demoDocuments({ session });
    const counts = new Map<string, { id: string; name: string; count: number }>();
    documents.flatMap((document) => document.contributors).forEach((person) => {
        const current = counts.get(person.id);
        counts.set(person.id, { id: person.id, name: person.name, count: (current?.count ?? 0) + 1 });
    });
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function demoRoles(session: number | "all" = SESSION_NUMBER) {
    const counts = new Map<string, number>();
    demoDocuments({ session }).flatMap((document) => document.contributors).forEach((person) => counts.set(person.role, (counts.get(person.role) ?? 0) + 1));
    return [...counts].map(([role, count]) => ({ role, count }));
}

export function demoKinds(session: number | "all" = SESSION_NUMBER) {
    const counts = new Map<DocumentKind, number>();
    demoDocuments({ session }).forEach((document) => counts.set(document.kind, (counts.get(document.kind) ?? 0) + 1));
    return [...counts].map(([kind, count]) => ({ kind, count }));
}

export function demoOffices() {
    return [
        { id: "demo-office-president", name: "Student Body President", count: 1 },
        { id: "demo-office-senate-president", name: "President of the Senate", count: 1 },
        { id: "demo-office-senator", name: "Class Senator", count: 1 },
    ];
}

export function demoSessions() {
    const counts = new Map<number, number>();
    site.documents.forEach((document) => counts.set(document.sessionNumber, (counts.get(document.sessionNumber) ?? 0) + 1));
    return [...counts]
        .map(([sessionNumber, documentCount]) => ({ sessionNumber, documentCount, isCurrent: sessionNumber === SESSION_NUMBER }))
        .sort((a, b) => b.sessionNumber - a.sessionNumber);
}

function lineageMember(document: RawDocument) {
    return {
        id: document.id,
        title: document.title,
        kind: documentKind(document.kind),
        sessionNumber: document.sessionNumber,
        driveModifiedTime: date(document.driveModifiedTime),
    };
}

export function demoLineage(lineageKey: string) {
    return {
        lineageKey,
        members: site.documents
            .filter((document) => document.lineageKey === lineageKey)
            .sort((a, b) => b.sessionNumber - a.sessionNumber)
            .map(lineageMember),
    };
}

export function demoComparableLineages() {
    const keys = [...new Set(site.documents.map((document) => document.lineageKey).filter(Boolean))];
    return keys.map(demoLineage).filter((lineage) => lineage.members.length > 1);
}

export function demoComparisonOptions(documentId: string) {
    const document = site.documents.find((entry) => entry.id === documentId);
    if (!document) return null;
    const comparable = isComparableKind(document.kind) && Boolean(document.lineageKey);
    return {
        document: {
            id: document.id,
            title: document.title,
            kind: documentKind(document.kind),
            sessionNumber: document.sessionNumber,
            lineageKey: document.lineageKey,
        },
        comparable,
        otherSessions: comparable
            ? site.documents.filter((entry) => entry.lineageKey === document.lineageKey && entry.id !== document.id).map(lineageMember)
            : [],
        revisions: [],
    };
}

export function demoComparison(beforeId: string, afterId: string) {
    const before = site.documents.find((document) => document.id === beforeId);
    const after = site.documents.find((document) => document.id === afterId);
    if (!before || !after) return null;
    const diff = diffLines(before.content, after.content);
    return {
        before: { id: before.id, title: before.title, sessionNumber: before.sessionNumber },
        after: { id: after.id, title: after.title, sessionNumber: after.sessionNumber },
        added: diff.added,
        removed: diff.removed,
        coarse: diff.coarse,
        ops: collapseUnchanged(diff),
    };
}

/** Contact fixtures use example.edu addresses so they cannot be mistaken for real students. */
export function demoDirectory() {
    const source = { id: "demo-constitution", title: "SGA Constitution (114th Session)" };
    const meeting = site.documents.find((document) => document.id === "demo-senate-minutes")!;
    return {
        sessionNumber: SESSION_NUMBER,
        members: site.directory.members.map((member) => {
            const mention = meeting.contributors.find((person) => person.id === member.id);
            const citation = mention ? {
                documentId: meeting.id,
                documentTitle: meeting.title,
                quote: mention.evidence,
            } : null;

            return {
                ...member,
                group: member.group as "executive" | "senate" | "judiciary",
                emailSource: null,
                // Each displayed office gets the meeting citation chip used by production data.
                positionSources: member.positions.map(() => citation),
                committeeSource: member.committees.length > 0 ? citation : null,
            };
        }),
        inboxes: site.directory.inboxes,
        sources: [source],
    };
}

export function demoSections(keys: string[]) {
    const citation = {
        id: "demo-section-citation",
        annotationId: "demo-constitution-citation-1",
        documentId: "demo-constitution",
        documentTitle: "SGA Constitution (114th Session)",
        quote: "The Association consists of an Executive Branch, a Legislative Branch, and a Judicial Branch.",
        href: "/documents/demo-constitution#annotation-demo-constitution-citation-1",
        orphaned: false,
    };
    return Object.fromEntries(keys.map((key) => [key, {
        key,
        content: sectionCopy(key),
        status: "fresh" as const,
        generatedAt: new Date("2026-09-09T15:15:00.000Z"),
        citations: [citation],
    }]));
}

function sectionCopy(key: string): string {
    if (key.includes("executive")) return "The Executive Branch coordinates the Association's work and carries out legislation passed by the Senate [1].";
    if (key.includes("legislative")) return "The Senate debates legislation, represents student constituencies, and oversees student activity funding [1].";
    if (key.includes("judicial")) return "The Judicial Branch interprets the governing documents and hears matters within its constitutional jurisdiction [1].";
    if (key.includes("programming")) return "Class programming councils plan events and programs for their respective class years [1].";
    if (key.includes("cse")) return "The Committee on Student Elections administers undergraduate SGA elections [1].";
    return "The Student Government Association represents Hopkins undergraduates through executive, legislative, and judicial bodies [1].";
}

export function demoForumCategories() {
    return FORUM_CATEGORIES.map((category) => ({
        ...category,
        count: site.forum.posts.filter((post) => post.categorySlug === category.slug).length,
    }));
}

function forumAuthor(name: string | null, label: string | null) {
    return { name, label };
}

export function demoForumPosts(categorySlug?: string) {
    return site.forum.posts
        .filter((post) => !categorySlug || post.categorySlug === categorySlug)
        .map((post) => ({
            id: post.id,
            title: post.title,
            categorySlug: post.categorySlug,
            categoryName: FORUM_CATEGORIES.find((category) => category.slug === post.categorySlug)?.name ?? post.categorySlug,
            createdAt: new Date(post.createdAt),
            replyCount: post.replies.length,
            author: forumAuthor(post.authorName, post.authorLabel),
            preview: post.body.slice(0, 240),
            hidden: false,
            hiddenReason: "",
            hiddenBy: "",
            locked: post.locked,
        }));
}

export function demoForumPost(postId: string) {
    const post = site.forum.posts.find((entry) => entry.id === postId);
    if (!post) return null;
    const summary = demoForumPosts().find((entry) => entry.id === postId)!;
    return {
        ...summary,
        body: post.body,
        replies: post.replies.map((reply) => ({
            id: reply.id,
            body: reply.body,
            createdAt: new Date(reply.createdAt),
            author: forumAuthor(reply.authorName, reply.authorLabel),
            hidden: false,
            hiddenReason: "",
            hiddenBy: "",
        })),
    };
}

export function demoModerationLog() {
    return [{
        id: "demo-moderation-1",
        targetType: "post",
        targetId: "demo-post-shuttle",
        action: "restore",
        reason: "Reviewed and found to be a good-faith campus-services question.",
        actorLabel: "Demo moderator",
        createdAt: new Date("2026-09-08T14:10:00.000Z"),
        context: "Publish shuttle changes in one place",
    }];
}

export function demoHeldQueue() {
    return [{
        id: "demo-held-reply",
        targetType: "reply" as const,
        title: "Reply to “Keep Brody open later during midterms”",
        body: "This sample reply is visible here to show how an automatic screening hold is reviewed.",
        reason: "Demo screening hold",
        createdAt: new Date("2026-09-10T12:00:00.000Z"),
    }];
}

export function demoSearchAnswer(question: string, scope: SearchScope) {
    const matches = demoDocuments({ session: scope === "all" ? "all" : SESSION_NUMBER }).slice(0, 3);
    return {
        question,
        scope,
        status: "fresh" as const,
        content: "The demo archive suggests starting with the constitution and recent Senate minutes [1].",
        citations: [{
            id: "demo-answer-citation",
            annotationId: "demo-constitution-citation-1",
            documentId: "demo-constitution",
            documentTitle: "SGA Constitution (114th Session)",
            quote: "The Student Government Association represents the undergraduate students of Johns Hopkins University.",
            href: "/documents/demo-constitution",
            orphaned: false,
        }],
        matches: matches.map((document) => ({
            id: document.id,
            title: document.title,
            kind: document.kind,
            sessionNumber: document.sessionNumber,
            heading: "Demo result",
            excerpt: document.description,
        })),
        generatedAt: new Date("2026-09-09T15:15:00.000Z"),
        error: null,
    };
}
