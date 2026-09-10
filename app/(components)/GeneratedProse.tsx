import type { Section } from "@/api/sections";
import CitedProse from "@/app/(components)/CitedProse";

/**
 * Renders one cached, cited section.
 *
 * The prose and its footnotes are rendered by CitedProse, which search answers
 * share; what belongs here is only what is true of a section specifically --
 * that it may be awaiting recheck after an amendment.
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

    return (
        <div>
            {section.status === "stale" && (
                <p className="text-foreground-400 italic">
                    A passage cited below has changed since this was written, so it is
                    awaiting recheck.
                </p>
            )}

            <CitedProse content={section.content} citations={section.citations} />
        </div>
    );
}
