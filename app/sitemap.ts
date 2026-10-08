import type { MetadataRoute } from "next";

import { getDocuments } from "@/api/documents";
import { getPosts } from "@/api/forum";
import { siteUrl } from "@/lib/seo";

/**
 * Every page a search engine should know about.
 *
 * Built on request rather than at deploy time: the archive changes with the
 * nightly sync and the forum changes whenever somebody posts, and a build
 * machine does not necessarily have a database to read either from.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const [documents, posts] = await Promise.all([
        getDocuments({ session: "all" }),
        getPosts(),
    ]);

    const fixed: MetadataRoute.Sitemap = [
        { url: "/", changeFrequency: "weekly", priority: 1 },
        { url: "/about", changeFrequency: "monthly", priority: 0.8 },
        { url: "/documents", changeFrequency: "daily", priority: 0.9 },
        { url: "/contact", changeFrequency: "monthly", priority: 0.7 },
        { url: "/discussion", changeFrequency: "daily", priority: 0.7 },
        { url: "/discussion/rules", changeFrequency: "yearly", priority: 0.3 },
        { url: "/discussion/moderation", changeFrequency: "daily", priority: 0.3 },
        { url: "/community", changeFrequency: "yearly", priority: 0.2 },
    ];

    const documentEntries: MetadataRoute.Sitemap = documents.map((document) => ({
        url: `/documents/${document.id}`,
        lastModified: document.driveModifiedTime ?? undefined,
        changeFrequency: "monthly",
        priority: 0.6,
    }));

    // Hidden threads carry their own noindex, so they are left out here too.
    const postEntries: MetadataRoute.Sitemap = posts
        .filter((post) => !post.hidden)
        .map((post) => ({
            url: `/discussion/${post.id}`,
            lastModified: post.createdAt,
            changeFrequency: "weekly",
            priority: 0.4,
        }));

    // Sitemap entries must be absolute; metadataBase does not reach this file.
    const base = siteUrl();
    return [...fixed, ...documentEntries, ...postEntries].map((entry) => ({
        ...entry,
        url: new URL(entry.url, base).toString(),
    }));
}
