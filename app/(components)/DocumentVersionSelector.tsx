"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DocumentVersionOption } from "@/lib/document-versions";
import styles from "@/app/documents/document-detail.module.css";

export default function DocumentVersionSelector({ options, selectedId, initiallyComparing = false, hasPrevious, children }: {
    options: DocumentVersionOption[]; selectedId: string; initiallyComparing?: boolean; hasPrevious: boolean; children: ReactNode;
}) {
    const router = useRouter();
    const [comparing, setComparing] = useState(initiallyComparing && hasPrevious);
    const [pending, startTransition] = useTransition();
    const latestId = options.at(-1)?.id;
    const choices = [...options].reverse().map(option => ({
        value: option.id,
        label: option.id === latestId ? "latest" : option.label,
    }));
    const selected = choices.find(choice => choice.value === selectedId);

    return <><div className={styles.versionSentence} aria-busy={pending}>
        You are viewing the{" "}
        {choices.length < 2 ? selected?.label : <select
            className={styles.versionSelect}
            aria-label="Document version"
            disabled={pending}
            value={selectedId}
            onChange={event => {
                const value = event.target.value;
                const url = new URL(window.location.href);
                url.searchParams.set("version", value);
                url.hash = "";
                startTransition(() => router.push(`${url.pathname}${url.search}`, { scroll: false }));
            }}
        >
            {choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>}{" "}
        version.{" "}
        {hasPrevious && <button
            type="button"
            className={styles.historyButton}
            aria-label={comparing ? "Close version history" : "View version history"}
            aria-expanded={comparing}
            aria-controls={comparing ? "document-version-history" : undefined}
            title="Version history"
            onClick={() => {
                const url = new URL(window.location.href);
                if (comparing) url.searchParams.delete("diff");
                else url.searchParams.set("diff", "1");
                url.hash = "";
                setComparing(!comparing);
                window.history.replaceState(null, "", `${url.pathname}${url.search}`);
            }}
        >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" />
                <path d="M12 7v5l3 2" />
            </svg>
        </button>}
    </div>
    {comparing && children}
    </>;
}
