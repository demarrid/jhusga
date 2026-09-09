import Link from "next/link";

import { truncateAtWord } from "@/lib/cite";

export type ChipCitation = {
    documentTitle: string;
    quote: string;
    href: string;
    orphaned?: boolean;
};

/**
 * An inline footnote-style chip. The visible label is a truncated document
 * title; the native title (and the hover panel) carry the full title and the
 * quoted passage.
 *
 * Styling kept minimal on purpose.
 */
export default function SourceChip({ citation }: { citation: ChipCitation }) {
    const quote = truncateAtWord(citation.quote, 220);
    const tooltip = citation.orphaned
        ? `${citation.documentTitle}\n\nThis passage has changed since it was cited.`
        : `${citation.documentTitle}\n\n${quote}`;

    return (
        <Link
            href={citation.href}
            title={tooltip}
            className="relative inline-block align-super mx-0.5 group"
        >
            <span className="bg-primary-400 text-white px-1.5 py-0.5 rounded-md text-xs">
                {citation.orphaned
                    ? "Source changed"
                    : truncateAtWord(citation.documentTitle, 28)}
            </span>
            <span className="hidden group-hover:block absolute left-0 top-full z-10 mt-1 w-72 bg-primary-100 text-foreground p-2 rounded-md text-sm font-normal whitespace-normal">
                <span className="block">{citation.documentTitle}</span>
                <span className="block mt-1">{quote}</span>
            </span>
        </Link>
    );
}
