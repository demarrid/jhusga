import Link from "next/link";

import { truncateAtWord } from "@/lib/cite";

import styles from "./SourceChip.module.css";

export type ChipCitation = {
    documentTitle: string;
    quote: string;
    href: string;
    orphaned?: boolean;
};

/**
 * An inline footnote-style chip. The visible label is a truncated document
 * title; a hover panel carries the full title and quoted passage.
 */
export default function SourceChip({ citation, mini }: { citation: ChipCitation, mini?: boolean }) {
    const quote = truncateAtWord(citation.quote, 220);

    const tooltip = (
        <span className={styles.tooltip}>
            <span>{citation.documentTitle}</span>
            <span>{quote}</span>
        </span>
    );

    if (mini) {
        // Keep the tooltip outside the clipped circle so the custom panel can show.
        return (
            <span className={styles.miniChipWrap}>
                <Link
                    href={citation.href}
                    className={`${styles.chip} ${styles.miniChip}`}
                    aria-label={`Source: ${citation.documentTitle}`}
                >
                    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 16 16">
                        <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588Z" />
                        <circle cx="8" cy="4.5" r="1" />
                    </svg>
                </Link>
                {tooltip}
            </span>
        );
    }

    return (
        <Link href={citation.href} className={styles.chip}>
            <span className={styles.label}>
                {citation.orphaned
                    ? "Source changed"
                    : truncateAtWord(citation.documentTitle, 28)}
            </span>
            {tooltip}
        </Link>
    );
}
