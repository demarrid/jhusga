import type { Comparison } from "@/api/archive";

/**
 * Renders a line diff between two versions of a document.
 *
 * Each line carries a "+" or "-" as well as a background colour, so the
 * change is legible without relying on colour alone.
 */
export default function DocumentDiff({ ops }: { ops: Comparison["ops"] }) {
    return (
        <div className="font-mono text-sm whitespace-pre-wrap">
            {ops.map((op, index) => {
                if (op.type === "skipped") {
                    return (
                        <p key={index} className="text-foreground-400 py-2">
                            {`... ${op.count} unchanged line${op.count === 1 ? "" : "s"}`}
                        </p>
                    );
                }

                const prefix =
                    op.type === "added" ? "+" : op.type === "removed" ? "-" : " ";
                const tone =
                    op.type === "added"
                        ? "bg-green-100 text-green-950"
                        : op.type === "removed"
                            ? "bg-red-100 text-red-950"
                            : "";

                return (
                    <div key={index} className={tone}>
                        {op.lines.map((line, lineIndex) => (
                            <div key={lineIndex}>{`${prefix} ${line}`}</div>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}
