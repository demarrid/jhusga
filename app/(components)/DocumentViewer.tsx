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
        case "heading": {
            const text = runsText(block.runs);
            // Docs exports the blank lines an author styled as headings, and
            // `# **` is all that is left of one with only emphasis in it.
            if (!/[\p{L}\p{N}]/u.test(text)) return null;
            // A whole paragraph set in a heading style -- the adjournment
            // notice under every agenda -- would otherwise print at title size.
            if (text.length > 160) {
                return (
                    <p
                        id={block.sectionId}
                        className={anchorClass(styles.viewerParagraph, block.sectionId)}
                    >
                        {renderRuns(block.runs)}
                    </p>
                );
            }
            return (
                <Heading level={block.level} sectionId={block.sectionId}>
                    {renderRuns(block.runs)}
                </Heading>
            );
        }

        case "paragraph":
            // pre-wrap keeps the line breaks the author typed; the export does
            // not soft-wrap, so every newline inside a paragraph is deliberate.
            return (
                <p
                    id={block.sectionId}
                    className={anchorClass(styles.viewerParagraph, block.sectionId)}
                >
                    {renderRuns(block.runs)}
                </p>
            );

        case "quote":
            return (
                <blockquote>
                    {renderBlocks(block.blocks)}
                </blockquote>
            );

        case "list":
            if (block.agenda) return <Agenda block={block} />;
            return block.ordered ? (
                // Numbering comes from the document itself, so a list that
                // resumes at 7 is shown starting at 7.
                <ol
                    start={block.start}
                    className={block.numbering ? styles.listTyped : undefined}
                >
                    {block.items.map((item, index) => {
                        const [label, text] = splitTypedMarker(item.runs, item.typedMarker ?? 0);
                        return (
                            <li
                                key={index}
                                value={item.value}
                                id={item.sectionId}
                                className={item.sectionId ? styles.sectionAnchor : undefined}
                            >
                                {label.length > 0 && (
                                    <span className={styles.typedMarker}>{renderRuns(label)}</span>
                                )}
                                {renderRuns(text)}
                                {renderBlocks(item.blocks)}
                            </li>
                        );
                    })}
                </ol>
            ) : (
                <ul>
                    {block.items.map((item, index) => (
                        <li
                            key={index}
                            id={item.sectionId}
                            className={item.sectionId ? styles.sectionAnchor : undefined}
                        >
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

/**
 * An agenda, laid out the way the Doc it came from is: each item a numbered
 * heading, and what falls under it indented beneath.
 *
 * The number is printed rather than left to the list marker so that it can be
 * set at the heading's size, and so it is the number the export wrote.
 */
function Agenda({ block }: { block: Extract<Block, { kind: "list" }> }) {
    return (
        <ol className={styles.agenda}>
            {block.items.map((item, index) => {
                const [title, ...rest] = item.blocks;
                const heading = title?.kind === "heading" && title.marker ? title : null;
                const body = heading ? rest : item.blocks;
                return (
                    <li key={index} value={item.value} className={styles.agendaItem}>
                        {heading && (
                            <h2
                                id={heading.sectionId}
                                className={[
                                    styles.agendaTitle,
                                    heading.ruled ? styles.agendaTitleRuled : "",
                                    heading.sectionId ? styles.sectionAnchor : "",
                                ].join(" ").trim()}
                            >
                                <span className={styles.agendaNumber}>{heading.marker}</span>{" "}
                                <span>{renderRuns(heading.runs)}</span>
                            </h2>
                        )}
                        {(item.runs.length > 0 || body.length > 0) && (
                            <div className={styles.agendaBody}>
                                {item.runs.length > 0 && (
                                    <p className={styles.viewerParagraph}>{renderRuns(item.runs)}</p>
                                )}
                                {renderBlocks(body)}
                            </div>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

function Heading({
    level,
    sectionId,
    children,
}: {
    level: number;
    sectionId?: string;
    children: ReactNode;
}) {
    // Levels are relative to the page's own h1, which is the document title.
    // `#` and `##` share an element, so the class is what sets them apart.
    const props = {
        id: sectionId,
        className:
            [level === 1 ? styles.viewerTopHeading : "", sectionId ? styles.sectionAnchor : ""]
                .join(" ")
                .trim() || undefined,
        children,
    };
    switch (level) {
        case 1:
        case 2:
            return <h2 {...props} />;
        case 3:
            return <h3 {...props} />;
        case 4:
            return <h4 {...props} />;
        default:
            return <h5 {...props} />;
    }
}

/** The outline scrolls to this block, so it clears the sticky header. */
function anchorClass(className: string, sectionId?: string): string {
    return sectionId ? `${className} ${styles.sectionAnchor}` : className;
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

/**
 * The "a." an author typed, apart from the words after it, so it can hang in
 * the margin like any other list marker.
 *
 * Runs are split rather than dropped: a citation can begin on the letter, and
 * the run that carries its anchor must survive even if it is only the space.
 */
function splitTypedMarker(runs: InlineRun[], length: number): [InlineRun[], InlineRun[]] {
    if (length === 0) return [[], runs];
    const label: InlineRun[] = [];
    const text: InlineRun[] = [];
    let remaining = length;
    for (const run of runs) {
        if (remaining <= 0) {
            text.push(run);
        } else if (run.text.length <= remaining) {
            label.push(run);
            remaining -= run.text.length;
        } else {
            label.push({ ...run, text: run.text.slice(0, remaining) });
            text.push({ ...run, text: run.text.slice(remaining), anchor: false });
            remaining = 0;
        }
    }
    // pre-wrap would print the space that separated the letter from the words.
    while (text.length > 0 && /^[ \t]/.test(text[0]!.text)) {
        const trimmed = { ...text[0]!, text: text[0]!.text.replace(/^[ \t]+/, "") };
        if (trimmed.text || trimmed.anchor) {
            text[0] = trimmed;
            break;
        }
        text.shift();
    }
    return [label, text];
}

function renderRuns(runs: InlineRun[]): ReactNode {
    return runs.map((run, index) => <Run key={index} run={run} />);
}

function Run({ run }: { run: InlineRun }) {
    let node: ReactNode = withLineGaps(run.text);

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

/**
 * A newline the author typed, set a little apart from the line above it.
 *
 * Under pre-wrap a typed break and a wrapped line sit the same distance
 * apart, so a list of short lines in a cell reads as one ragged paragraph.
 * The spacer is a block of its own, which breaks the line without the
 * newline character, and stays inside any highlight or bold around it.
 */
function withLineGaps(text: string): ReactNode {
    if (!text.includes("\n")) return text;
    return text.split("\n").flatMap((piece, index) =>
        index === 0 ? [piece] : [<span key={index} className={styles.lineGap} aria-hidden="true" />, piece],
    );
}
