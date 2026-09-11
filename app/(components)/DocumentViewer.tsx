import type { ReactNode } from "react";

import { runsText, type Block, type InlineRun, type TableRow } from "@/lib/render";
import styles from "@/app/documents/document-detail.module.css";

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
    return <article className={styles.viewer}>{renderBlocks(blocks)}</article>;
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
            return <p className={styles.viewerParagraph}>{renderRuns(block.runs)}</p>;

        case "quote":
            return (
                <blockquote>
                    {renderBlocks(block.blocks)}
                </blockquote>
            );

        case "list":
            return block.ordered ? (
                // Numbering comes from the document itself, so a list that
                // resumes at 7 is shown starting at 7.
                <ol start={block.start}>
                    {block.items.map((item, index) => (
                        <li key={index}>
                            {renderRuns(item.runs)}
                            {renderBlocks(item.blocks)}
                        </li>
                    ))}
                </ol>
            ) : (
                <ul>
                    {block.items.map((item, index) => (
                        <li key={index}>
                            {renderRuns(item.runs)}
                            {renderBlocks(item.blocks)}
                        </li>
                    ))}
                </ul>
            );

        case "table":
            return (
                <div className={styles.viewerTable}>
                    <table>
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

        case "layout":
            return (
                <div className={styles.viewerLayout}>
                    {block.rows.map((row, index) => (
                        <LayoutRow key={index} row={row} />
                    ))}
                </div>
            );

        case "rule":
            return <hr />;
    }
}

/**
 * A row of a table the author used for layout, read as text instead.
 *
 * The first cell with anything in it is the item; the minutes template puts
 * who leads it, or who was present for it, in the cells after. Those are an
 * aside beside the text rather than a column, and an empty cell -- the
 * template leaves plenty -- is nothing at all.
 */
function LayoutRow({ row }: { row: TableRow }) {
    const filled = row.cells.filter((cell) => runsText(cell).trim().length > 0);
    if (filled.length === 0) return null;

    const [item, ...aside] = filled;

    return (
        <div className={styles.viewerLayoutRow}>
            <p className={styles.viewerLayoutItem}>{renderRuns(item)}</p>
            {aside.length > 0 && (
                <p className={styles.viewerLayoutAside}>
                    {aside.map((cell, index) => (
                        <span key={index}>{renderRuns(cell)}</span>
                    ))}
                </p>
            )}
        </div>
    );
}

function Heading({ level, children }: { level: number; children: ReactNode }) {
    // Levels are relative to the page's own h1, which is the document title.
    switch (level) {
        case 1:
        case 2:
            return <h2>{children}</h2>;
        case 3:
            return <h3>{children}</h3>;
        case 4:
            return <h4>{children}</h4>;
        default:
            return <h5>{children}</h5>;
    }
}

function Row({ row, cell }: { row: TableRow; cell: "th" | "td" }) {
    const Cell = cell;
    return (
        <tr>
            {row.cells.map((runs, index) => (
                <Cell key={index}>
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
                className={styles.annotation}
            >
                {node}
            </mark>
        );
    }

    return node;
}
