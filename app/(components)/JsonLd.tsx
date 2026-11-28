import { serializeJsonLd } from "@/lib/seo";

/**
 * Structured data for search engines, rendered in the page body.
 *
 * A plain <script> rather than next/script: this is data, not code to load.
 */
export default function JsonLd({ data }: { data: object }) {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
        />
    );
}
