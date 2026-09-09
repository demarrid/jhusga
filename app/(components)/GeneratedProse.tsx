import type { Section, SectionCitation } from "@/api/sections";
import SourceChip from "@/app/(components)/SourceChip";
import { citedIndexes, splitCitedParts } from "@/lib/cite";

/**
 * Renders one cached, cited section.
 *
 * Citation markers in the cached text (`[1]`, `[2]`) become inline chips, so
 * a claim and its source sit together the way a footnote number would. Markers
 * the model forgot still appear at the end rather than disappearing.
 */
export default function GeneratedProse({
    section,
}: {
    section: Section | null;
}) {
    if (!section || !section.content) {
        return (
            <p className="text-foreground-400 italic">
                Not yet summarised from the governing documents.
            </p>
        );
    }

    const byIndex = new Map<number, SectionCitation>();
    section.citations.forEach((citation, index) => {
        byIndex.set(index + 1, citation);
    });

    const used = new Set(citedIndexes(section.content));
    const leftover = section.citations.filter((_, index) => !used.has(index + 1));

    return (
        <div>
            {section.status === "stale" && (
                <p className="text-foreground-400 italic">
                    A passage cited below has changed since this was written, so it is
                    awaiting recheck.
                </p>
            )}

            {renderBlocks(section.content, byIndex)}

            {leftover.length > 0 && (
                <p>
                    {leftover.map((citation) => (
                        <SourceChip key={citation.id} citation={citation} />
                    ))}
                </p>
            )}
        </div>
    );
}

function renderBlocks(
    content: string,
    byIndex: Map<number, SectionCitation>,
) {
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

function renderCitedLine(
    text: string,
    byIndex: Map<number, SectionCitation>,
) {
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
