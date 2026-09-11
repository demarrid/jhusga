import Link from "next/link";

import { getViewer } from "@/api/auth";
import { getCategories, getPosts, type ForumPostSummary } from "@/api/forum";
import { formatDateShort } from "@/lib/dates";

import DiscussionHeader from "./DiscussionHeader";
import styles from "./discussion.module.css";

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
        <main className={styles.page}>
            <DiscussionHeader eyebrow="Public forum" title="Discussion">
              <p>
                Anything undergraduates want to raise with the SGA, or with each
                other, without a name attached.{" "}
                <Link href="/discussion/rules" className={styles.howItWorksLink}>
                    How it works
                </Link> explains anonymity and public moderation.
              </p>
            </DiscussionHeader>

            <section className={styles.forumChapter}>
              <aside className={styles.forumRail}>
                <span>01</span>
                <h2>Public threads</h2>
                <Link href="/discussion/moderation">Moderation log ↗</Link>
              </aside>

              <div className={styles.forumContent}>
                <div className={styles.toolbar}>
                  <div>
                    <h2>{selected ? selected.name : "All threads"}</h2>
                    <p>{selected?.description ?? "Questions, proposals, criticism, and conversation from Hopkins undergraduates."}</p>
                  </div>
                {viewer ? (
                    <Link
                        className={styles.primaryAction}
                        href="/discussion/new"
                    >
                        Start a thread
                    </Link>
                ) : (
                    <Link
                        className={styles.primaryAction}
                        href="/auth?next=/discussion/new"
                    >
                        Sign in to post
                    </Link>
                )}

                </div>

                <nav className={styles.categoryNav} aria-label="Discussion categories">
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
                </nav>

            {posts.length === 0 ? (
                <p className={styles.emptyState}>
                    {selected
                        ? `Nothing in ${selected.name} yet.`
                        : "Nothing has been posted yet."}
                </p>
            ) : (
                <ul className={styles.postList}>
                    {posts.map((post, index) => (
                        <PostRow key={post.id} post={post} index={index + 1} />
                    ))}
                </ul>
            )}
              </div>
            </section>
        </main>
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
            // Filtering changes the list in place; keep the reader at the forum controls.
            scroll={false}
            className={`${styles.categoryLink} ${active ? styles.categoryLinkActive : ""}`}
        >
            {label}
        </Link>
    );
}

function PostRow({ post, index }: { post: ForumPostSummary; index: number }) {
    return (
        <li className={styles.postRow}>
            <span className={styles.postIndex}>{String(index).padStart(2, "0")}</span>
            <article>
              <Link className={styles.postTitle} href={`/discussion/${post.id}`}>{post.title}</Link>

              <div className={styles.postMeta}>
                {[
                    post.categoryName,
                    formatDateShort(post.createdAt),
                    post.replyCount === 1 ? "1 reply" : `${post.replyCount} replies`,
                ].join(" · ")}

            {/*
              * An officer's post says so in the listing. This is the only
              * author line the forum ever prints, and it is here rather than
              * only on the thread so a reader can see at a glance which of
              * these came from inside the SGA.
              */}
            {post.author.name && (
                <span>
                    {" · "}
                    {post.author.name}
                    {post.author.label ? `, ${post.author.label}` : ""}
                </span>
            )}
              </div>

            {post.hidden ? (
                <p className={styles.postPreview}>
                    Hidden by a moderator: {post.hiddenReason} It is still
                    readable, and the decision is in the log.
                </p>
            ) : (
                <p className={styles.postPreview}>{post.preview}</p>
            )}
            </article>
            <Link className={styles.postArrow} href={`/discussion/${post.id}`} aria-label={`Open ${post.title}`}>↗</Link>
        </li>
    );
}
