import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getViewer } from "@/api/auth";
import { getPost, type ForumAuthor } from "@/api/forum";
import ModerationControls from "@/app/(components)/ModerationControls";
import ReplyForm from "@/app/(components)/ReplyForm";
import { formatDateShort } from "@/lib/dates";
import { pageMetadata } from "@/lib/seo";

import DiscussionHeader from "../DiscussionHeader";
import styles from "../discussion.module.css";

export const dynamic = "force-dynamic";

// One read per request, shared between the metadata and the page.
const loadPost = cache(getPost);

/**
 * The embed for a thread is the thread's own title and its opening lines,
 * which is what a reader following the link would see first anyway.
 *
 * A hidden thread's text stays on the page behind a click and nowhere else:
 * the description says it was hidden and why, and the page is kept out of
 * search results, because a moderator's decision should not be undone by
 * whatever crawled the page before they made it.
 */
export async function generateMetadata({
    params,
}: {
    params: Promise<{ postId: string }>;
}): Promise<Metadata> {
    const { postId } = await params;
    const post = await loadPost(postId);
    if (!post) notFound();

    const description = post.hidden
        ? `${post.hiddenBy === "screen" ? "Held for review" : "Hidden by a moderator"}: ${post.hiddenReason} ` +
          `The text is still readable on the page, and the decision is in the moderation log.`
        : post.body;

    return pageMetadata({
        title: post.title,
        description,
        path: `/discussion/${post.id}`,
        type: "article",
        noIndex: post.hidden,
    });
}

/**
 * One thread.
 *
 * Hidden material is rendered here rather than withheld: collapsed behind a
 * summary that names the reason, but present. A reader who cannot see what was
 * removed has no way to judge whether removing it was right, and that
 * judgement is the only real check on a forum with one moderator.
 */
export default async function Thread({
    params,
}: {
    params: Promise<{ postId: string }>;
}) {
    const { postId } = await params;
    const [viewer, post] = await Promise.all([getViewer(), loadPost(postId)]);

    if (!post) notFound();

    const moderating = viewer?.role === "moderator";

    return (
        <main className={styles.page}>
          <DiscussionHeader eyebrow={post.categoryName} title="Discussion thread" compact />
          <div className={styles.content}>
           <article className={styles.thread}>
            <p className={styles.breadcrumb}>
                <Link href="/discussion">
                    Discussion
                </Link>
                {" · "}
                <Link
                    href={`/discussion?category=${post.categorySlug}`}
                >
                    {post.categoryName}
                </Link>
            </p>

            <h1 className={styles.threadTitle}>{post.title}</h1>

            <p className={styles.threadMeta}>
                <Byline author={post.author} />
                {" · "}
                {formatDateShort(post.createdAt)}
                {post.locked && " · replies are locked"}
            </p>

            <Body
                text={post.body}
                hidden={post.hidden}
                hiddenBy={post.hiddenBy}
                reason={post.hiddenReason}
                what="thread"
            />

            {moderating && (
                <ModerationControls
                    targetType="post"
                    targetId={post.id}
                    hidden={post.hidden}
                    hiddenBy={post.hiddenBy}
                    locked={post.locked}
                />
            )}

            <section className={styles.replies}>
            <h2 className={styles.repliesHeading}>
                {post.replies.length === 0
                    ? "No replies yet"
                    : post.replies.length === 1
                        ? "1 reply"
                        : `${post.replies.length} replies`}
            </h2>

            {post.replies.map((reply) => (
                <article key={reply.id} className={styles.reply}>
                    <p className={styles.threadMeta}>
                        <Byline author={reply.author} />
                        {" · "}
                        {formatDateShort(reply.createdAt)}
                    </p>

                    <Body
                        text={reply.body}
                        hidden={reply.hidden}
                        hiddenBy={reply.hiddenBy}
                        reason={reply.hiddenReason}
                        what="reply"
                    />

                    {moderating && (
                        <ModerationControls
                            targetType="reply"
                            targetId={reply.id}
                            hidden={reply.hidden}
                            hiddenBy={reply.hiddenBy}
                        />
                    )}
                </article>
            ))}
            </section>

            {post.locked ? (
                <p className={styles.lockedNotice}>
                    A moderator locked this thread. It stays readable, and the
                    reason is in the{" "}
                    <Link className={styles.inlineLink} href="/discussion/moderation">
                        log
                    </Link>
                    .
                </p>
            ) : viewer ? (
                <ReplyForm
                    postId={post.id}
                    officeLabel={viewer.affiliateId ? viewer.officeLabel : null}
                />
            ) : (
                <p className={styles.replyPrompt}>
                    <Link
                        className={styles.inlineLink}
                        href={`/auth?next=/discussion/${post.id}`}
                    >
                        Sign in with a Hopkins address
                    </Link>{" "}
                    to reply. Reading needs nothing.
                </p>
            )}
           </article>
          </div>
        </main>
    );
}

/** Anonymous unless an officeholder chose otherwise, which is nearly always. */
function Byline({ author }: { author: ForumAuthor }) {
    if (!author.name) return <span>Anonymous</span>;
    return (
        <span>
            {author.name}
            {author.label ? `, ${author.label}` : ""}
        </span>
    );
}

/**
 * Collapsed rather than removed, using plain `details` so it works without
 * JavaScript — a reader on a locked-down browser can still audit a removal.
 */
function Body({
    text,
    hidden,
    hiddenBy,
    reason,
    what,
}: {
    text: string;
    hidden: boolean;
    hiddenBy: string;
    reason: string;
    what: string;
}) {
    const paragraphs = text.split(/\n{2,}/).filter((line) => line.trim().length > 0);

    const content = paragraphs.map((paragraph, index) => (
        <p key={index}>
            {paragraph}
        </p>
    ));

    if (!hidden) return <div className={styles.body}>{content}</div>;

    // A held item and a hidden one read differently on purpose. One is a
    // machine's guess nobody has checked; the other is somebody's decision.
    return (
        <details className={styles.hiddenBody}>
            <summary>
                {hiddenBy === "screen"
                    ? `Screening is holding this ${what} until a moderator looks at it, so it is not listed on the discussion: ${reason}`
                    : `A moderator hid this ${what}: ${reason}`}
            </summary>
            <div className={styles.body}>{content}</div>
        </details>
    );
}
