"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Select from "@/app/(components)/Select";
import type { DocumentVersionOption } from "@/lib/document-versions";
import styles from "@/app/documents/document-detail.module.css";

export default function DocumentVersionSelector({ options, selectedId }: {
    options: DocumentVersionOption[]; selectedId: string;
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
        version.
    </div>;
}
