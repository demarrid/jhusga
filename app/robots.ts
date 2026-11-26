import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/seo";

/**
 * What crawlers may index.
 *
 * Everything readable is indexable: that is the point of a public record.
 * The exceptions are the sign-in form and the composer, which are pages only
 * in the sense of having a URL, and the API routes, which are not pages at
 * all. Hidden threads opt themselves out through their own robots meta tag.
 *
 * Search and filter combinations are not pages either. Each one is a fresh
 * server render, and their cross product is effectively unbounded, so crawlers
 * keep to the listing, its category views (`?kind=`, `?archive=1`), and each
 * document's own URL, which is cached. Every document is in the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: "*",
            allow: "/",
            disallow: [
                "/api/", "/auth", "/discussion/new",
                // Listing filters, search, sort, and modes.
                "/documents?*q=", "/documents?*person=", "/documents?*role=", "/documents?*office=",
                "/documents?*sort=", "/documents?*lineage=", "/documents?*mode=",
                // Saved versions, version history, comparisons, and search-return
                // copies of a document; its plain URL is the indexable one.
                "/documents/*?*version=", "/documents/*?*diff=", "/documents/*?*returnTo=",
                "/documents/*/version", "/documents/*/compare",
            ],
        },
        sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
    };
}
