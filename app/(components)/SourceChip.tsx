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
export default function SourceChip({ citation, mini }: { citation: ChipCitation, mini?: boolean }) {
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

            {mini ? (
                <span className="inline-flex items-center rounded-md bg-primary-400 p-0.5 text-white">
                    <svg
                        aria-hidden="true"
                        className="size-4"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                    >
                        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
                        <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588Z" />
                        <circle cx="8" cy="4.5" r="1" />
                    </svg>
                </span>
            ) : (
                <>
                    <span className="bg-primary-400 text-white px-1.5 py-0.5 rounded-md text-xs">
                        {citation.orphaned
                            ? "Source changed"
                            : truncateAtWord(citation.documentTitle, 28)}
                    </span>
                    <span className="hidden group-hover:block absolute left-0 top-full z-10 mt-1 w-72 bg-primary-100 text-foreground p-2 rounded-md text-sm font-normal whitespace-normal">
                        <span className="block">{citation.documentTitle}</span>
                        <span className="block mt-1">{quote}</span>
                    </span>
                </>
            )}
        </Link>
    );
}
