import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/seo";

/**
 * What crawlers may index.
 *
 * Everything readable is indexable: that is the point of a public record.
 * The exceptions are the sign-in form and the composer, which are pages only
 * in the sense of having a URL, and the API routes, which are not pages at
 * all. Hidden threads opt themselves out through their own robots meta tag.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: "*",
            allow: "/",
            disallow: ["/api/", "/auth", "/discussion/new"],
        },
        sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
    };
}
