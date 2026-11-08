"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Select from "@/app/(components)/Select";
import type { DocumentVersionOption } from "@/lib/document-versions";
import styles from "@/app/documents/document-detail.module.css";

export default function DocumentVersionSelector({ options, selectedId, comparing = false }: {
    options: DocumentVersionOption[]; selectedId: string; comparing?: boolean;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const latestId = options.at(-1)?.id;
    const choices = [...options].reverse().map(option => ({
        value: option.id,
        label: option.id === latestId ? "latest" : option.label,
    }));
    const selected = choices.find(choice => choice.value === selectedId);

    return <div className={styles.versionSentence} aria-busy={pending}>
        You are viewing the{" "}
        {choices.length < 2 ? selected?.label : <Select
            variant="inline"
            ariaLabel="Document version"
            value={selectedId}
            options={choices}
            onChange={value => {
                const url = new URL(window.location.href);
                url.searchParams.set("version", value);
                url.hash = "";
                startTransition(() => router.push(`${url.pathname}${url.search}`, { scroll: false }));
            }}
        />}{" "}
        version.{" "}
        <button
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
                startTransition(() => router.push(`${url.pathname}${url.search}`, { scroll: false }));
            }}
        >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" />
                <path d="M12 7v5l3 2" />
            </svg>
        </button>
    </div>;
}
