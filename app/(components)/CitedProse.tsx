import type { ReactNode } from "react";

import SourceChip, { type ChipCitation } from "@/app/(components)/SourceChip";
import { citedIndexes, splitCitedParts } from "@/lib/cite";
import { proseInlineRuns, type InlineRun } from "@/lib/render";

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
    bulleted = false,
}: {
    content: string;
    citations: ProseCitation[];
    bulleted?: boolean;
}) {
    const byIndex = new Map<number, ProseCitation>();
    citations.forEach((citation, index) => {
        byIndex.set(index + 1, citation);
    });

    const used = new Set(citedIndexes(content));
    const leftover = citations.filter((_, index) => !used.has(index + 1));

    return (
        <>
            {bulleted ? renderBulletedBlocks(content, byIndex, bulleted) : renderBlocks(content, byIndex, bulleted)}

            {leftover.length > 0 && (
                <p>
                    {leftover.map((citation) => (
                        <SourceChip key={citation.id} citation={citation} mini={bulleted} />
                    ))}
                </p>
            )}
        </>
    );
}

function renderBulletedBlocks(
    content: string,
    byIndex: Map<number, ProseCitation>,
    miniChips: boolean,
) {
    const points = content
        .split(/\n\s*\n/)
        .flatMap((block) => block.split("\n"))
        .map((line) => line.trim().replace(/^[-*•]\s+/, ""))
        .filter(Boolean);

    return (
        <ul>
            {points.map((point, index) => (
                <li key={index}>{renderCitedLine(point, byIndex, miniChips)}</li>
            ))}
        </ul>
    );
}

function renderBlocks(content: string, byIndex: Map<number, ProseCitation>, miniChips: boolean) {
    const blocks = content.split(/\n\s*\n/).filter(Boolean);

    return blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const bullets = lines.filter((line) => /^[-*•]\s+/.test(line));

        if (bullets.length > 0 && bullets.length === lines.length) {
            return (
                <ul key={index}>
                    {lines.map((line, lineIndex) => (
                        <li key={lineIndex}>
                            {renderCitedLine(line.replace(/^[-*•]\s+/, ""), byIndex, miniChips)}
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
                        {renderCitedLine(line.replace(/^[-*•]\s+/, ""), byIndex, miniChips)}
                    </span>
                ))}
            </p>
        );
    });
}

function renderCitedLine(text: string, byIndex: Map<number, ProseCitation>, miniChips: boolean) {
    return splitCitedParts(text).map((part, index) => {
        if (part.type === "text") {
            return <span key={index}>{renderInlineMarkdown(part.value)}</span>;
        }

        const citation = byIndex.get(part.index);
        if (!citation) {
            return <span key={index}>{`[${part.index}]`}</span>;
        }

        return <SourceChip key={`${citation.id}-${index}`} citation={citation} mini={miniChips} />;
    });
}

function renderInlineMarkdown(text: string): ReactNode {
    return proseInlineRuns(text).map((run, index) => (
        <MarkdownRun key={index} run={run} />
    ));
}

function MarkdownRun({ run }: { run: InlineRun }) {
    let node: ReactNode = run.text;

    if (run.strike) node = <s>{node}</s>;
    if (run.italic) node = <em>{node}</em>;
    if (run.bold) node = <strong>{node}</strong>;

    if (run.href) {
        node = (
            <a href={run.href} target="_blank" rel="noreferrer">
                {node}
            </a>
        );
    }

    return node;
}
