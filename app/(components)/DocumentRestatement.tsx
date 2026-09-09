import type { DocumentRestatement as Restatement, SummaryCitation } from "@/api/documents";
import { citedIndexes, splitCitedParts, truncateAtWord } from "@/lib/cite";

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
    if (!restatement || !restatement.content) {
        return (
            <p className="text-foreground-400 italic">
                No plain-language summary yet. Run <code>npm run summarize</code> to
                write one from this document.
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
        <div>
            {restatement.status === "stale" && (
                <p className="text-foreground-400 italic">
                    The document has changed since this was written, so it is awaiting
                    recheck. Read the document itself for anything that matters.
                </p>
            )}

            {renderBlocks(restatement.content, byIndex)}

            {leftover.length > 0 && (
                <p className="mt-2">
                    {leftover.map((citation, index) => (
                        <QuoteChip
                            key={citation.annotationId}
                            citation={citation}
                            index={used.size + index + 1}
                        />
                    ))}
                </p>
            )}

            <p className="text-foreground-400 text-sm mt-3">
                Written from this document alone. Every claim links to the passage it
                came from.
            </p>
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
            title={
                citation.orphaned
                    ? "This passage has changed since it was cited."
                    : quote
            }
            className="relative inline-block align-super mx-0.5 group"
        >
            <span className="bg-primary-400 text-white px-1.5 rounded-md text-xs">
                {citation.orphaned ? "changed" : index}
            </span>
            <span className="hidden group-hover:block absolute left-0 top-full z-10 mt-1 w-72 bg-primary-100 text-foreground p-2 rounded-md text-sm font-normal whitespace-normal">
                {quote}
            </span>
        </a>
    );
}

function renderBlocks(content: string, byIndex: Map<number, SummaryCitation>) {
    const blocks = content.split(/\n\s*\n/).filter(Boolean);

    return blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const bullets = lines.filter((line) => /^[-*•]\s+/.test(line));

        if (bullets.length > 0 && bullets.length === lines.length) {
            return (
                <ul key={index}>
                    {lines.map((line, lineIndex) => (
                        <li key={lineIndex}>
                            {renderCitedLine(line.replace(/^[-*•]\s+/, ""), byIndex)}
                        </li>
                    ))}
                </ul>
            );
        }

        return (
            <p key={index}>
                {lines.map((line, lineIndex) => (
                    <span key={lineIndex}>
                        {lineIndex > 0 && <br />}
                        {renderCitedLine(line.replace(/^[-*•]\s+/, ""), byIndex)}
                    </span>
                ))}
            </p>
        );
    });
}

function renderCitedLine(text: string, byIndex: Map<number, SummaryCitation>) {
    return splitCitedParts(text).map((part, index) => {
        if (part.type === "text") {
            return <span key={index}>{part.value}</span>;
        }

        const citation = byIndex.get(part.index);
        // A marker the model invented has nothing to point at, so it is shown
        // as written rather than silently dropped.
        if (!citation) {
            return <span key={index}>{`[${part.index}]`}</span>;
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
