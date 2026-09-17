import type { DocumentRestatement as Restatement, SummaryCitation } from "@/api/documents";
import { citedIndexes, splitCitedParts, truncateAtWord } from "@/lib/cite";
import styles from "@/app/documents/document-detail.module.css";

/**
 * The plain-language reading of a document, shown beside it.
 *
 * Differs from GeneratedProse in where the citations point. A section cites
 * across the archive, so its chips are labelled with the document they came
 * from; a restatement only ever cites the document already on screen, so the
 * chip is just a number and clicking it jumps to the highlighted passage a
 * few centimetres to the left. That is the whole contract: every sentence
 * here can be checked against the author's own words without leaving the page.
 */
export default function DocumentRestatement({
    restatement,
}: {
    restatement: Restatement | null;
}) {
    // "Empty" is a decision and not a gap, and saying "not yet" about it would
    // promise a summary that is never coming. But it is reached two ways, and
    // one sentence for both called a full set of minutes a template: a document
    // no model was sent is being judged on its length, while one a model read
    // is being judged on what it says.
    if (!restatement || !restatement.content) {
        return (
            <p className={styles.muted}>
                {restatement?.status !== "empty"
                    ? "No plain-language summary yet. The nightly sync writes one."
                    : restatement.readByModel
                        ? "This document was read, and it states nothing a restatement would add."
                        : "There is too little text here to restate — a stub, or a template nobody has filled in."}
            </p>
        );
    }

    const byIndex = new Map<number, SummaryCitation>();
    restatement.citations.forEach((citation, index) => {
        byIndex.set(index + 1, citation);
    });

    const used = new Set(citedIndexes(restatement.content));
    const leftover = restatement.citations.filter((_, index) => !used.has(index + 1));

    return (
        <div className={styles.summary}>
            {restatement.status === "stale" && (
                <p className={styles.muted}>
                    The document has changed since this was written, so it is awaiting
                    recheck. Read the document itself for anything that matters.
                </p>
            )}

            {renderBlocks(restatement.content, byIndex)}

            {leftover.length > 0 && (
                <p>
                    {leftover.map((citation, index) => (
                        <QuoteChip
                            key={citation.annotationId}
                            citation={citation}
                            index={used.size + index + 1}
                        />
                    ))}
                </p>
            )}

        </div>
    );
}

/**
 * A numbered marker that scrolls to, and highlights, the passage backing the
 * claim it follows.
 */
function QuoteChip({
    citation,
    index,
}: {
    citation: SummaryCitation;
    index: number;
}) {
    const quote = truncateAtWord(citation.quote, 220);

    return (
        <a
            href={citation.orphaned ? undefined : citation.href}
            className={styles.citation}
        >
            <span className={styles.citationMark}>
                {citation.orphaned ? "changed" : index}
            </span>
            <span className={styles.citationTooltip}>
                {quote}
            </span>
        </a>
    );
}

function renderBlocks(content: string, byIndex: Map<number, SummaryCitation>) {
    const points = content
        .split(/\n\s*\n/)
        .flatMap((block) => block.split("\n"))
        .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
        .filter(Boolean);

    return (
        <ul>
            {points.map((point, index) => (
                <li key={index}>{renderCitedLine(point, byIndex)}</li>
            ))}
        </ul>
    );
}

function renderCitedLine(text: string, byIndex: Map<number, SummaryCitation>) {
    return splitCitedParts(text).map((part, index) => {
        if (part.type === "text") {
            return <span key={index}>{part.value}</span>;
        }

        const citation = byIndex.get(part.index);
        // A marker the model invented, or one whose quote did not survive
        // verification, has nothing to point at. Leaving `[9]` in the prose
        // reads as a broken footnote; dropping it leaves the claim and the
        // chips that do resolve.
        if (!citation) {
            return null;
        }

        return (
            <QuoteChip
                key={`${citation.annotationId}-${index}`}
                citation={citation}
                index={part.index}
            />
        );
    });
}
