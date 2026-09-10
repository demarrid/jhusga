import Link from "next/link";

import { getViewer } from "@/api/auth";
import { getCategories, getPosts, type ForumPostSummary } from "@/api/forum";
import { formatDateShort } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * The forum's front page.
 *
 * Readable by anyone, signed in or not, including the hidden posts and the
 * moderation log. Signing in is only ever required to write, and the page says
 * so rather than presenting a wall.
 */
export default async function Discussion({
    searchParams,
}: {
    searchParams: Promise<{ category?: string }>;
}) {
    const { category } = await searchParams;
    const [viewer, categories, posts] = await Promise.all([
        getViewer(),
        getCategories(),
        getPosts(category),
    ]);

    const selected = categories.find((entry) => entry.slug === category);

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1>Discussion</h1>

            <p>
                Anything undergraduates want to raise with the SGA, or with each
                other, without a name attached.{" "}
                <Link className="text-primary-700" href="/discussion/rules">
                    How it works
                </Link>{" "}
                — what is kept, what is not, and how moderation is published.
            </p>

            <div className="flex flex-row flex-wrap items-center gap-3 my-4">
                {viewer ? (
                    <Link
                        className="bg-primary-400 text-white px-3 py-1 rounded-md"
                        href="/discussion/new"
                    >
                        Start a thread
                    </Link>
                ) : (
                    <Link
                        className="bg-primary-400 text-white px-3 py-1 rounded-md"
                        href="/auth?next=/discussion/new"
                    >
                        Sign in to post
                    </Link>
                )}

                <Link className="text-primary-700" href="/discussion/moderation">
                    Moderation log
                </Link>
            </div>

            <section className="my-6">
                <h2>Categories</h2>
                <p className="flex flex-row flex-wrap gap-2 my-2">
                    <CategoryChip
                        href="/discussion"
                        label="Everything"
                        active={!selected}
                    />
                    {categories.map((entry) => (
                        <CategoryChip
                            key={entry.slug}
                            href={`/discussion?category=${entry.slug}`}
                            label={`${entry.name} (${entry.count})`}
                            active={selected?.slug === entry.slug}
                        />
                    ))}
                </p>
                {selected && (
                    <p className="text-foreground-400">{selected.description}</p>
                )}
            </section>

            {posts.length === 0 ? (
                <p className="text-foreground-400 italic">
                    {selected
                        ? `Nothing in ${selected.name} yet.`
                        : "Nothing has been posted yet."}
                </p>
            ) : (
                <ul>
                    {posts.map((post) => (
                        <PostRow key={post.id} post={post} />
                    ))}
                </ul>
            )}
        </div>
    );
}

function CategoryChip({
    href,
    label,
    active,
}: {
    href: string;
    label: string;
    active: boolean;
}) {
    return (
        <Link
            href={href}
            className={
                active
                    ? "bg-primary-400 text-white px-2 py-1 rounded-md"
                    : "bg-primary-100 text-primary-700 px-2 py-1 rounded-md"
            }
        >
            {label}
        </Link>
    );
}

function PostRow({ post }: { post: ForumPostSummary }) {
    return (
        <li className="my-3">
            <Link href={`/discussion/${post.id}`}>{post.title}</Link>

            <span className="text-foreground-400">
                {" — "}
                {[
                    post.categoryName,
                    formatDateShort(post.createdAt),
                    post.replyCount === 1 ? "1 reply" : `${post.replyCount} replies`,
                ].join(" · ")}
            </span>

            {/*
              * An officer's post says so in the listing. This is the only
              * author line the forum ever prints, and it is here rather than
              * only on the thread so a reader can see at a glance which of
              * these came from inside the SGA.
              */}
            {post.author.name && (
                <span className="text-foreground-400">
                    {" · "}
                    {post.author.name}
                    {post.author.label ? `, ${post.author.label}` : ""}
                </span>
            )}

            {post.hidden ? (
                <p className="text-foreground-400 italic">
                    Hidden by a moderator: {post.hiddenReason} It is still
                    readable, and the decision is in the log.
                </p>
            ) : (
                <p className="text-foreground-400 text-sm">{post.preview}</p>
            )}
        </li>
    );
}
