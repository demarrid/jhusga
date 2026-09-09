import type { ReactNode } from "react";

import type { Block, InlineRun, TableRow } from "@/lib/render";

/**
 * Renders a parsed document with its cited passages highlighted.
 *
 * All of the parsing happens in lib/render, which keeps every run tied to the
 * offsets it came from; this file only decides what each block looks like.
 *
 * Anchors are plain `id`s, so linking to #annotation-<id> from a SourceChip
 * scrolls here and the :target rule emphasises the passage -- no client JS.
 */
export default function DocumentViewer({ blocks }: { blocks: Block[] }) {
    return <article className="font-serif">{renderBlocks(blocks)}</article>;
}

function renderBlocks(blocks: Block[]): ReactNode {
    return blocks.map((block, index) => (
        <BlockView key={index} block={block} />
    ));
}

function BlockView({ block }: { block: Block }) {
    switch (block.kind) {
        case "heading":
            return <Heading level={block.level}>{renderRuns(block.runs)}</Heading>;

        case "paragraph":
            // pre-wrap keeps the line breaks the author typed; the export does
            // not soft-wrap, so every newline inside a paragraph is deliberate.
            return <p className="my-4 whitespace-pre-wrap">{renderRuns(block.runs)}</p>;

        case "quote":
            return (
                <blockquote className="border-primary-300 my-4 border-l-4 pl-4">
                    {renderBlocks(block.blocks)}
                </blockquote>
            );

        case "list":
            return block.ordered ? (
                // Numbering comes from the document itself, so a list that
                // resumes at 7 is shown starting at 7.
                <ol start={block.start} className="my-4 list-decimal pl-8">
                    {block.items.map((item, index) => (
                        <li key={index} className="my-1 whitespace-pre-wrap">
                            {renderRuns(item.runs)}
                            {renderBlocks(item.blocks)}
                        </li>
                    ))}
                </ol>
            ) : (
                <ul className="my-4 list-disc pl-8">
                    {block.items.map((item, index) => (
                        <li key={index} className="my-1 whitespace-pre-wrap">
                            {renderRuns(item.runs)}
                            {renderBlocks(item.blocks)}
                        </li>
                    ))}
                </ul>
            );

        case "table":
            return (
                <div className="my-4 overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                        {block.header && (
                            <thead>
                                <Row row={block.header} cell="th" />
                            </thead>
                        )}
                        <tbody>
                            {block.rows.map((row, index) => (
                                <Row key={index} row={row} cell="td" />
                            ))}
                        </tbody>
                    </table>
                </div>
            );

        case "rule":
            return <hr className="border-primary-300 my-6" />;
    }
}

function Heading({ level, children }: { level: number; children: ReactNode }) {
    // Levels are relative to the page's own h1, which is the document title.
    switch (level) {
        case 1:
        case 2:
            return <h2 className="mt-8 mb-2">{children}</h2>;
        case 3:
            return <h3 className="mt-6 mb-2">{children}</h3>;
        case 4:
            return <h4 className="mt-6 mb-2">{children}</h4>;
        default:
            return <h5 className="mt-4 mb-2">{children}</h5>;
    }
}

function Row({ row, cell }: { row: TableRow; cell: "th" | "td" }) {
    const Cell = cell;
    return (
        <tr>
            {row.cells.map((runs, index) => (
                <Cell
                    key={index}
                    className="border-primary-300 border p-2 align-top"
                >
                    {renderRuns(runs)}
                </Cell>
            ))}
        </tr>
    );
}

function renderRuns(runs: InlineRun[]): ReactNode {
    return runs.map((run, index) => <Run key={index} run={run} />);
}

function Run({ run }: { run: InlineRun }) {
    let node: ReactNode = run.text;

    if (run.strike) node = <s>{node}</s>;
    if (run.italic) node = <em>{node}</em>;
    if (run.bold) node = <strong>{node}</strong>;

    if (run.href) {
        node = (
            <a
                href={run.href}
                target="_blank"
                rel="noreferrer"
                className="text-primary-700 underline"
            >
                {node}
            </a>
        );
    }

    if (run.annotationId) {
        node = (
            <mark
                // Only the first run of a citation carries the anchor, so a
                // highlight broken up by a bold word has one target, not three.
                id={run.anchor ? `annotation-${run.annotationId}` : undefined}
                // scroll-mt clears the sticky header.
                className="bg-secondary-200 target:bg-secondary-300 scroll-mt-28"
            >
                {node}
            </mark>
        );
    }

    return node;
}
