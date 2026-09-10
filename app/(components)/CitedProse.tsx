import SourceChip, { type ChipCitation } from "@/app/(components)/SourceChip";
import { citedIndexes, splitCitedParts } from "@/lib/cite";

/**
 * Model-written prose with its footnotes resolved.
 *
 * Citation markers in the stored text (`[1]`, `[2]`) become inline chips, so a
 * claim and its source sit together the way a footnote number would. Markers
 * the model forgot still appear at the end rather than disappearing: a quote
 * that was verified is evidence whether or not the prose pointed at it.
 *
 * Shared by the cached page sections and by search answers, which differ in
 * where their text came from and not at all in how it should read.
 */

export type ProseCitation = ChipCitation & { id: string };

export default function CitedProse({
    content,
    citations,
}: {
    content: string;
    citations: ProseCitation[];
}) {
    const byIndex = new Map<number, ProseCitation>();
    citations.forEach((citation, index) => {
        byIndex.set(index + 1, citation);
    });

    const used = new Set(citedIndexes(content));
    const leftover = citations.filter((_, index) => !used.has(index + 1));

    return (
        <>
            {renderBlocks(content, byIndex)}

            {leftover.length > 0 && (
                <p>
                    {leftover.map((citation) => (
                        <SourceChip key={citation.id} citation={citation} />
                    ))}
                </p>
            )}
        </>
    );
}

function renderBlocks(content: string, byIndex: Map<number, ProseCitation>) {
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

function renderCitedLine(text: string, byIndex: Map<number, ProseCitation>) {
    return splitCitedParts(text).map((part, index) => {
        if (part.type === "text") {
            return <span key={index}>{part.value}</span>;
        }

        const citation = byIndex.get(part.index);
        if (!citation) {
            return <span key={index}>{`[${part.index}]`}</span>;
        }

        return <SourceChip key={`${citation.id}-${index}`} citation={citation} />;
    });
}
