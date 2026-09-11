import type { Comparison } from "@/api/archive";
import styles from "@/app/documents/document-detail.module.css";

/**
 * Renders a line diff between two versions of a document.
 *
 * Each line carries a "+" or "-" as well as a background colour, so the
 * change is legible without relying on colour alone.
 */
export default function DocumentDiff({ ops }: { ops: Comparison["ops"] }) {
    return (
        <div className={styles.diff}>
            {ops.map((op, index) => {
                if (op.type === "skipped") {
                    return (
                        <p key={index} className={styles.diffSkipped}>
                            {`... ${op.count} unchanged line${op.count === 1 ? "" : "s"}`}
                        </p>
                    );
                }

                const prefix =
                    op.type === "added" ? "+" : op.type === "removed" ? "-" : " ";
                const tone =
                    op.type === "added"
                        ? styles.diffAdded
                        : op.type === "removed"
                            ? styles.diffRemoved
                            : "";

                return (
                    <div key={index} className={tone}>
                        {op.lines.map((line, lineIndex) => (
                            <div className={styles.diffLine} key={lineIndex}>{`${prefix} ${line}`}</div>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}
