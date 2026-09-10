import Link from "next/link";
import { notFound } from "next/navigation";

import { getViewer } from "@/api/auth";
import { getPost, type ForumAuthor } from "@/api/forum";
import ModerationControls from "@/app/(components)/ModerationControls";
import ReplyForm from "@/app/(components)/ReplyForm";
import { formatDateShort } from "@/lib/dates";

export const dynamic = "force-dynamic";

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
    const [viewer, post] = await Promise.all([getViewer(), getPost(postId)]);

    if (!post) notFound();

    const moderating = viewer?.role === "moderator";

    return (
        <div className="max-w-4xl mx-auto p-6">
            <p className="text-foreground-400">
                <Link className="text-primary-700" href="/discussion">
                    Discussion
                </Link>
                {" · "}
                <Link
                    className="text-primary-700"
                    href={`/discussion?category=${post.categorySlug}`}
                >
                    {post.categoryName}
                </Link>
            </p>

            <h1>{post.title}</h1>

            <p className="text-foreground-400">
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

            <h2>
                {post.replies.length === 0
                    ? "No replies yet"
                    : post.replies.length === 1
                        ? "1 reply"
                        : `${post.replies.length} replies`}
            </h2>

            {post.replies.map((reply) => (
                <div key={reply.id} className="border-l-2 border-primary-100 pl-3 my-4">
                    <p className="text-foreground-400">
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
                </div>
            ))}

            {post.locked ? (
                <p className="text-foreground-400 italic my-6">
                    A moderator locked this thread. It stays readable, and the
                    reason is in the{" "}
                    <Link className="text-primary-700" href="/discussion/moderation">
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
                <p className="my-6">
                    <Link
                        className="text-primary-700"
                        href={`/auth?next=/discussion/${post.id}`}
                    >
                        Sign in with a Hopkins address
                    </Link>{" "}
                    to reply. Reading needs nothing.
                </p>
            )}
        </div>
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
        <p key={index} className="whitespace-pre-wrap">
            {paragraph}
        </p>
    ));

    if (!hidden) return <div className="my-3">{content}</div>;

    // A held item and a hidden one read differently on purpose. One is a
    // machine's guess nobody has checked; the other is somebody's decision.
    return (
        <details className="bg-primary-100 rounded-md p-3 my-3">
            <summary className="text-red-500">
                {hiddenBy === "screen"
                    ? `Screening is holding this ${what} until a moderator looks at it, so it is not listed on the discussion: ${reason}`
                    : `A moderator hid this ${what}: ${reason}`}
            </summary>
            <div className="my-3">{content}</div>
        </details>
    );
}
