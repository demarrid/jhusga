import type { Section } from "@/api/sections";
import CitedProse from "@/app/(components)/CitedProse";

import styles from "./GeneratedProse.module.css";

/**
 * Renders one cached, cited section.
 *
 * The prose and its footnotes are rendered by CitedProse, which search answers
 * share; what belongs here is only what is true of a section specifically --
 * that it may be awaiting recheck after an amendment.
 */
export default function GeneratedProse({
    section,
    bulleted = false,
}: {
    section: Section | null;
    bulleted?: boolean;
}) {
    if (!section || !section.content) {
        return (
            <p className={styles.muted}>
                Not yet summarised from the governing documents.
            </p>
        );
    }

    return (
        <div>
            {section.status === "stale" && (
                <p className={styles.muted}>
                    A passage cited below has changed since this was written, so it is
                    awaiting recheck.
                </p>
            )}

            <CitedProse
                content={section.content}
                citations={section.citations}
                bulleted={bulleted}
            />
        </div>
    );
}
