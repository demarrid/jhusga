'use server'

import { revalidatePath } from "next/cache";

import {
    BODY_MAX_CHARS,
    BODY_MIN_CHARS,
    DEFAULT_CATEGORY_SLUG,
    FORUM_CATEGORIES,
    TITLE_MAX_CHARS,
    TITLE_MIN_CHARS,
} from "@/config/forum";
import { currentViewer } from "@/lib/login";
import { screenSubmission } from "@/lib/moderate";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/ratelimit";
import { demoModeEnabled } from "@/lib/data-mode";
import {
    demoForumCategories,
    demoForumPost,
    demoForumPosts,
    demoHeldQueue,
    demoModerationLog,
} from "@/lib/demo-data";

/**
 * Reading and writing the forum.
 *
 * Reads are open to anyone, signed in or not, including the moderation log.
 * Writes need a session, and no write anywhere in this file records who made
 * it unless the writer holds office and asked to be named.
 *
 * There is no way to unsay something. A post cannot be deleted by whoever
 * wrote it, only hidden by a moderator, and hiding is logged in public with a
 * reason. See the note in lib/login.ts for why self-deletion is the wrong
 * power to hand out on an anonymous forum.
 *
 * Two different things can withhold a submission, and the difference runs
 * through this whole file. Screening holds a post back before anybody has seen
 * it, which keeps spam out of the listing but rests on a model's guess, so a
 * held post is kept out of the listing entirely until a person has looked. A
 * moderator hiding something is a decision with a name attached, so it stays
 * listed and readable behind a click, for anyone who wants to argue with it.
 * Both write a row to ModerationAction the moment they happen: what is
 * withheld is the text, never the fact that something was withheld.
 */

export type ForumAuthor = {
    /** Null for an anonymous post, which is most of them. */
    name: string | null;
    /** The office as it read when the post was made. */
    label: string | null;
};

export type ForumPostSummary = {
    id: string;
    title: string;
    categorySlug: string;
    categoryName: string;
    createdAt: Date;
    replyCount: number;
    author: ForumAuthor;
    /** An excerpt, for the listing. */
    preview: string;
    hidden: boolean;
    hiddenReason: string;
    /** "" when visible, else "screen" (awaiting review) or "moderator". */
    hiddenBy: string;
    locked: boolean;
};

export type ForumReplyView = {
    id: string;
    body: string;
    createdAt: Date;
    author: ForumAuthor;
    hidden: boolean;
    hiddenReason: string;
    hiddenBy: string;
};

export type ForumPostView = ForumPostSummary & {
    body: string;
    replies: ForumReplyView[];
};

export type WriteResult = { ok: boolean; error?: string; id?: string; notice?: string };

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The categories, created on first use.
 *
 * Seeded from config rather than a migration so that editing the list is a
 * code change with a diff, and so a new category does not need a deploy of the
 * database to appear.
 */
export async function getCategories(): Promise<
    { slug: string; name: string; description: string; count: number }[]
> {
    if (demoModeEnabled()) return demoForumCategories();
    await ensureCategories();

    const counts = await prisma.forumPost.groupBy({
        by: ["categoryId"],
        _count: { categoryId: true },
        where: { hiddenAt: null },
    });

    const categories = await prisma.forumCategory.findMany({
        orderBy: { ordinal: "asc" },
    });

    return categories.map((category) => ({
        slug: category.slug,
        name: category.name,
        description: category.description,
        count:
            counts.find((row) => row.categoryId === category.id)?._count.categoryId ?? 0,
    }));
}

// Once per process, not once per page view. The seed is idempotent, but six
// upserts on every render of a page that is already `force-dynamic` is a cost
// for nothing; a cold start re-syncs whatever the last deploy changed.
let categoriesReady: Promise<void> | null = null;

async function ensureCategories(): Promise<void> {
    categoriesReady ??= (async () => {
        for (const [ordinal, seed] of FORUM_CATEGORIES.entries()) {
            await prisma.forumCategory.upsert({
                where: { slug: seed.slug },
                create: { ...seed, ordinal },
                update: { name: seed.name, description: seed.description, ordinal },
            });
        }
    })().catch((cause) => {
        // Let the next caller try again rather than caching the failure.
        categoriesReady = null;
        throw cause;
    });

    return categoriesReady;
}

function authorOf(row: {
    authorLabel: string;
    authorAffiliate: { name: string } | null;
}): ForumAuthor {
    return {
        name: row.authorAffiliate?.name ?? null,
        label: row.authorLabel || null,
    };
}

const PREVIEW_CHARS = 240;

export async function getPosts(
    categorySlug?: string,
): Promise<ForumPostSummary[]> {
    if (demoModeEnabled()) return demoForumPosts(categorySlug);
    const posts = await prisma.forumPost.findMany({
        where: {
            // Held by screening and not yet looked at, so it is not put in
            // front of readers at all. The hold is in the moderation log, and
            // the post is reachable from there; what is withheld here is the
            // attention, not the record.
            NOT: { hiddenBy: "screen" },
            ...(categorySlug ? { category: { slug: categorySlug } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
            id: true,
            title: true,
            body: true,
            createdAt: true,
            authorLabel: true,
            hiddenAt: true,
            hiddenReason: true,
            hiddenBy: true,
            lockedAt: true,
            authorAffiliate: { select: { name: true } },
            category: { select: { slug: true, name: true } },
            // Held replies are not counted either; a thread should not
            // advertise three replies and then show one.
            _count: { select: { replies: { where: { NOT: { hiddenBy: "screen" } } } } },
        },
    });

    return posts.map((post) => ({
        id: post.id,
        title: post.title,
        categorySlug: post.category.slug,
        categoryName: post.category.name,
        createdAt: post.createdAt,
        replyCount: post._count.replies,
        author: authorOf(post),
        // A hidden post's text is not put in a listing. It stays readable on
        // its own page behind a click, which is where the moderation note
        // explaining the removal also is.
        preview: post.hiddenAt ? "" : post.body.replace(/\s+/g, " ").slice(0, PREVIEW_CHARS),
        hidden: post.hiddenAt !== null,
        hiddenReason: post.hiddenReason,
        hiddenBy: post.hiddenBy,
        locked: post.lockedAt !== null,
    }));
}

export async function getPost(postId: string): Promise<ForumPostView | null> {
    if (demoModeEnabled()) return demoForumPost(postId);
    const post = await prisma.forumPost.findUnique({
        where: { id: postId },
        select: {
            id: true,
            title: true,
            body: true,
            createdAt: true,
            authorLabel: true,
            hiddenAt: true,
            hiddenReason: true,
            hiddenBy: true,
            lockedAt: true,
            authorAffiliate: { select: { name: true } },
            category: { select: { slug: true, name: true } },
            replies: {
                // A reply held by screening is left out of the thread. Unlike
                // the post it answers, it has no page of its own to be read
                // on, so the log entry is the whole of its record until a
                // moderator either publishes it or upholds the hold.
                where: { NOT: { hiddenBy: "screen" } },
                orderBy: { createdAt: "asc" },
                select: {
                    id: true,
                    body: true,
                    createdAt: true,
                    authorLabel: true,
                    hiddenAt: true,
                    hiddenReason: true,
                    hiddenBy: true,
                    authorAffiliate: { select: { name: true } },
                },
            },
        },
    });

    if (!post) return null;

    const replies: ForumReplyView[] = post.replies.map((reply) => ({
        id: reply.id,
        body: reply.body,
        createdAt: reply.createdAt,
        author: authorOf(reply),
        hidden: reply.hiddenAt !== null,
        hiddenReason: reply.hiddenReason,
        hiddenBy: reply.hiddenBy,
    }));

    return {
        id: post.id,
        title: post.title,
        body: post.body,
        categorySlug: post.category.slug,
        categoryName: post.category.name,
        createdAt: post.createdAt,
        replyCount: post.replies.length,
        author: authorOf(post),
        preview: "",
        hidden: post.hiddenAt !== null,
        hiddenReason: post.hiddenReason,
        hiddenBy: post.hiddenBy,
        locked: post.lockedAt !== null,
        replies,
    };
}

export type ModerationEntry = {
    id: string;
    targetType: string;
    targetId: string;
    action: string;
    reason: string;
    actorLabel: string;
    createdAt: Date;
    /** The title of the thread involved, so the log reads as something. */
    context: string;
};

/**
 * Every moderation action ever taken, by a person or by the screening.
 *
 * Open to everyone, signed in or not. A log only constrains a moderator if the
 * people they moderate can read it -- and it is the only place a screening
 * hold shows up at all, since a held post is kept out of the listing.
 */
export async function getModerationLog(): Promise<ModerationEntry[]> {
    if (demoModeEnabled()) return demoModerationLog();
    const actions = await prisma.moderationAction.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
    });

    const postIds = actions
        .filter((action) => action.targetType === "post")
        .map((action) => action.targetId);
    const replyIds = actions
        .filter((action) => action.targetType === "reply")
        .map((action) => action.targetId);

    const [posts, replies] = await Promise.all([
        prisma.forumPost.findMany({
            where: { id: { in: postIds } },
            select: { id: true, title: true },
        }),
        prisma.forumReply.findMany({
            where: { id: { in: replyIds } },
            select: { id: true, post: { select: { title: true } } },
        }),
    ]);

    const titles = new Map<string, string>();
    for (const post of posts) titles.set(post.id, post.title);
    for (const reply of replies) titles.set(reply.id, `reply to “${reply.post.title}”`);

    return actions.map((action) => ({
        id: action.id,
        targetType: action.targetType,
        targetId: action.targetId,
        action: action.action,
        reason: action.reason,
        actorLabel: action.actorLabel,
        createdAt: action.createdAt,
        context: titles.get(action.targetId) ?? "a deleted item",
    }));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function checkBody(body: string): string | null {
    const trimmed = body.trim();
    if (trimmed.length < BODY_MIN_CHARS) return "That is too short to post.";
    if (trimmed.length > BODY_MAX_CHARS) {
        return `That is longer than the ${BODY_MAX_CHARS.toLocaleString()} character limit.`;
    }
    return null;
}

export async function createPost(input: {
    title: string;
    body: string;
    categorySlug: string;
    /** Officeholders only, and off by default. */
    postAsOfficer?: boolean;
}): Promise<WriteResult> {
    if (demoModeEnabled()) return { ok: true, id: "demo-post-library", notice: "Demo mode: the post was not saved." };
    const viewer = await currentViewer();
    if (!viewer) {
        return { ok: false, error: "Sign in with a Hopkins address to post." };
    }

    const title = input.title.trim();
    if (title.length < TITLE_MIN_CHARS) return { ok: false, error: "Give it a longer title." };
    if (title.length > TITLE_MAX_CHARS) {
        return { ok: false, error: `Titles are limited to ${TITLE_MAX_CHARS} characters.` };
    }

    const bodyProblem = checkBody(input.body);
    if (bodyProblem) return { ok: false, error: bodyProblem };

    for (const action of ["post", "post_daily"] as const) {
        const limit = await consumeRateLimit(action);
        if (!limit.allowed) {
            return {
                ok: false,
                error: `You have posted several threads recently. Try again in ${describe(limit.retryAfterSeconds)}. Replies are not affected.`,
            };
        }
    }

    await ensureCategories();

    const screen = await screenSubmission({ title, body: input.body });

    const slug = FORUM_CATEGORIES.some((entry) => entry.slug === input.categorySlug)
        ? input.categorySlug
        : screen.categorySlug ?? DEFAULT_CATEGORY_SLUG;

    const category = await prisma.forumCategory.findUnique({ where: { slug } });
    if (!category) return { ok: false, error: "That category no longer exists." };

    const named = Boolean(input.postAsOfficer && viewer.affiliateId);
    const held = screen.state === "flagged";

    const post = await prisma.forumPost.create({
        data: {
            categoryId: category.id,
            title,
            body: input.body.trim(),
            screenState: screen.state,
            screenReason: screen.reason,
            ...heldFields(screen),
            authorAffiliateId: named ? viewer.affiliateId : null,
            authorLabel: named ? viewer.officeLabel ?? "" : "",
        },
        select: { id: true },
    });

    if (held) await logHold("post", post.id, screen.reason);

    revalidatePath("/discussion");
    revalidatePath("/discussion/moderation");

    return {
        ok: true,
        id: post.id,
        notice: held ? HELD_NOTICE : undefined,
    };
}

const HELD_NOTICE =
    "Screening held this back, so it is not on the discussion yet. The hold is already in the moderation log, with the reason, and a moderator will either publish it or say why not — that decision is published too.";

/** The columns that put a submission on hold, or leave it published. */
function heldFields(screen: { state: string; reason: string }) {
    const held = screen.state === "flagged";
    return {
        hiddenAt: held ? new Date() : null,
        hiddenReason: held ? screen.reason : "",
        hiddenBy: held ? "screen" : "",
    };
}

/**
 * Record the hold, immediately.
 *
 * Written in the same request as the post, not by a later job, because the
 * whole justification for withholding something automatically is that the
 * withholding is public from the first moment. A hold nobody can see is a
 * silent deletion with extra steps.
 */
async function logHold(
    targetType: "post" | "reply",
    targetId: string,
    reason: string,
): Promise<void> {
    await prisma.moderationAction.create({
        data: {
            targetType,
            targetId,
            action: "withhold",
            reason: reason || "Flagged by screening without a stated reason",
            // Not a person, and it does not pretend to be one.
            actorLabel: "Automatic screening",
        },
    });
}

export async function createReply(input: {
    postId: string;
    body: string;
    postAsOfficer?: boolean;
}): Promise<WriteResult> {
    if (demoModeEnabled()) return { ok: true, id: "demo-reply-1", notice: "Demo mode: the reply was not saved." };
    const viewer = await currentViewer();
    if (!viewer) {
        return { ok: false, error: "Sign in with a Hopkins address to reply." };
    }

    const bodyProblem = checkBody(input.body);
    if (bodyProblem) return { ok: false, error: bodyProblem };

    const post = await prisma.forumPost.findUnique({
        where: { id: input.postId },
        select: { id: true, lockedAt: true },
    });
    if (!post) return { ok: false, error: "That thread no longer exists." };
    if (post.lockedAt) return { ok: false, error: "That thread is locked." };

    for (const action of ["reply", "reply_daily"] as const) {
        const limit = await consumeRateLimit(action);
        if (!limit.allowed) {
            return {
                ok: false,
                error: `You have replied a lot in a short time. Try again in ${describe(limit.retryAfterSeconds)}.`,
            };
        }
    }

    const screen = await screenSubmission({ body: input.body });
    const named = Boolean(input.postAsOfficer && viewer.affiliateId);
    const held = screen.state === "flagged";

    const reply = await prisma.forumReply.create({
        data: {
            postId: post.id,
            body: input.body.trim(),
            screenState: screen.state,
            screenReason: screen.reason,
            ...heldFields(screen),
            authorAffiliateId: named ? viewer.affiliateId : null,
            authorLabel: named ? viewer.officeLabel ?? "" : "",
        },
        select: { id: true },
    });

    if (held) await logHold("reply", reply.id, screen.reason);

    revalidatePath(`/discussion/${post.id}`);
    revalidatePath("/discussion/moderation");

    return { ok: true, id: reply.id, notice: held ? HELD_NOTICE : undefined };
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

export type ModerationVerb = "hide" | "uphold" | "restore" | "lock" | "unlock";

/**
 * A moderator's decision -- always with a reason, always logged.
 *
 * Nothing is deleted. Hidden material stays in the database and stays readable
 * behind a click, because a reader who cannot see what was removed cannot
 * judge whether removing it was right, and that judgement is the only check on
 * a forum with one moderator.
 *
 * "uphold" exists because a screening hold is provisional and something has to
 * end it. It converts the machine's guess into a person's decision: same text
 * withheld, but now under a name and a reason, and back in the listing where
 * it can be argued with. Without it a held post would sit out of sight
 * indefinitely, which is the outcome the log was meant to prevent.
 */
export async function moderate(input: {
    targetType: "post" | "reply";
    targetId: string;
    action: ModerationVerb;
    reason: string;
}): Promise<WriteResult> {
    const viewer = await currentViewer();
    if (viewer?.role !== "moderator") {
        return { ok: false, error: "Only a moderator can do that." };
    }

    const reason = input.reason.trim();
    const needsReason = input.action === "hide" || input.action === "uphold" || input.action === "lock";
    if (needsReason && reason.length < 4) {
        return { ok: false, error: "Say why. The reason is published with the action." };
    }

    // A moderator acts under their own name. This is the one place on the
    // forum where anonymity is not on offer.
    const actorLabel =
        [viewer.affiliateName, viewer.officeLabel].filter(Boolean).join(", ") ||
        "Site moderator";

    const now = new Date();

    // Hiding and upholding write the same columns. They differ in what came
    // before -- a moderator reaching for a visible post, or ratifying a hold
    // the screening put there -- and the log keeps them apart so a reader can
    // tell how a decision was arrived at.
    const withhold = { hiddenAt: now, hiddenReason: reason, hiddenBy: "moderator" };
    const publish = { hiddenAt: null, hiddenReason: "", hiddenBy: "" };

    if (input.targetType === "post") {
        const data =
            input.action === "hide" || input.action === "uphold"
                ? withhold
                : input.action === "restore"
                    ? publish
                    : input.action === "lock"
                        ? { lockedAt: now }
                        : { lockedAt: null };

        const updated = await prisma.forumPost
            .update({ where: { id: input.targetId }, data })
            .catch(() => null);
        if (!updated) return { ok: false, error: "That thread no longer exists." };
    } else {
        if (input.action === "lock" || input.action === "unlock") {
            return { ok: false, error: "Only a thread can be locked." };
        }

        const data =
            input.action === "hide" || input.action === "uphold" ? withhold : publish;

        const updated = await prisma.forumReply
            .update({ where: { id: input.targetId }, data })
            .catch(() => null);
        if (!updated) return { ok: false, error: "That reply no longer exists." };
    }

    await prisma.moderationAction.create({
        data: {
            targetType: input.targetType,
            targetId: input.targetId,
            action: input.action,
            reason,
            actorLabel,
        },
    });

    // The whole subtree: a reply's id is not a route, so revalidating the
    // thread it belongs to would mean fetching its parent just to name a path.
    revalidatePath("/discussion", "layout");

    return { ok: true, notice: "Done, and logged." };
}

/**
 * What screening is holding, oldest first, for a moderator to work through.
 *
 * Deliberately not restricted to moderators. Anyone can already see from the
 * log that these are being held; showing the queue only makes the backlog
 * countable, which is the number worth being embarrassed by.
 */
export async function getHeldQueue(): Promise<
    { id: string; targetType: "post" | "reply"; title: string; body: string; reason: string; createdAt: Date }[]
> {
    if (demoModeEnabled()) return demoHeldQueue();
    const [posts, replies] = await Promise.all([
        prisma.forumPost.findMany({
            where: { hiddenBy: "screen" },
            orderBy: { createdAt: "asc" },
            select: { id: true, title: true, body: true, hiddenReason: true, createdAt: true },
        }),
        prisma.forumReply.findMany({
            where: { hiddenBy: "screen" },
            orderBy: { createdAt: "asc" },
            select: {
                id: true,
                body: true,
                hiddenReason: true,
                createdAt: true,
                post: { select: { title: true } },
            },
        }),
    ]);

    return [
        ...posts.map((post) => ({
            id: post.id,
            targetType: "post" as const,
            title: post.title,
            body: post.body,
            reason: post.hiddenReason,
            createdAt: post.createdAt,
        })),
        ...replies.map((reply) => ({
            id: reply.id,
            targetType: "reply" as const,
            title: `Reply to “${reply.post.title}”`,
            body: reply.body,
            reason: reply.hiddenReason,
            createdAt: reply.createdAt,
        })),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function describe(seconds: number): string {
    if (seconds < 90) return "a minute";
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 90) return `${minutes} minutes`;
    return `${Math.ceil(minutes / 60)} hours`;
}
