"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import Checkbox from "@/app/(components)/Checkbox";
import Select from "@/app/(components)/Select";
import { contributorRoleLabel } from "@/lib/contributors";
import { documentKindLabel } from "@/lib/kinds";

import styles from "./DocumentSearch.module.css";

/** How long typing pauses before the listing is asked to catch up. */
const TYPING_SETTLE_MS = 250;

/**
 * The filters above the document listing.
 *
 * Still a plain GET form, so every result set stays a linkable URL and the
 * page keeps working with JavaScript off -- the Search button below is the
 * fallback for that case. With JavaScript, changing a filter applies it
 * immediately: choosing a person and then having to press Search reads as a
 * bug, and the listing is cheap enough to re-fetch on each keystroke once
 * typing has settled.
 */
export default function DocumentSearch({
    query,
    kind,
    person,
    role,
    office,
    archive,
    kinds,
    people,
    roles,
    offices,
}: {
    query?: string;
    kind?: string;
    person?: string;
    role?: string;
    office?: string;
    archive: boolean;
    kinds: { kind: string; count: number }[];
    people: { id: string; name: string; count: number }[];
    roles: { role: string; count: number }[];
    offices: { id: string; name: string; count: number }[];
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [pending, startTransition] = useTransition();
    const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const queryInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        return () => {
            if (typingTimer.current) clearTimeout(typingTimer.current);
        };
    }, []);

    // Rebuilt from the live URL rather than from props so that a filter set a
    // moment ago is not dropped by the next one, and so unrelated params such
    // as `lineage` survive.
    function apply(changes: Record<string, string>) {
        const params = new URLSearchParams(searchParams.toString());

        for (const [key, value] of Object.entries(changes)) {
            if (value) params.set(key, value);
            else params.delete(key);
        }

        const search = params.toString();

        // replace, not push: the back button should leave the listing, not
        // walk back through every filter the reader tried.
        startTransition(() => {
            router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
        });
    }

    function applyQuery(value: string) {
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => apply({ q: value }), TYPING_SETTLE_MS);
    }

    return (
        <form
            className={styles.form}
            // Enter should apply what has been typed now rather than waiting
            // out the timer, but without the full page load a GET would do.
            onSubmit={(event) => {
                event.preventDefault();
                if (typingTimer.current) clearTimeout(typingTimer.current);
                const value = new FormData(event.currentTarget).get("q");
                apply({ q: typeof value === "string" ? value : "" });
            }}
        >
            <div className={styles.queryRow}>
                <span className={styles.queryCaption}>Search documents and people</span>
                <label className={styles.queryControl}>
                    <span className={styles.hiddenLabel}>Search documents and people</span>
                    <input
                        ref={queryInput}
                        type="search"
                        name="q"
                        defaultValue={query}
                        placeholder="Title, keyword, or person"
                        onChange={(event) => applyQuery(event.target.value)}
                    />
                    <button
                        type="button"
                        className={styles.clearQuery}
                        aria-label="Clear document search"
                        onClick={() => {
                            if (typingTimer.current) clearTimeout(typingTimer.current);
                            if (queryInput.current) {
                                queryInput.current.value = "";
                                queryInput.current.focus();
                            }
                            apply({ q: "" });
                        }}
                    >
                        <span aria-hidden="true">×</span>
                    </button>
                </label>

                <div className={styles.archiveToggle}>
                    <Checkbox
                        name="archive"
                        value="1"
                        defaultChecked={archive}
                        onChange={(checked) => apply({ archive: checked ? "1" : "" })}
                    >
                        Include past sessions
                    </Checkbox>
                </div>
            </div>

            <div className={styles.filterRow}>
                <div className={styles.filterField}>
                    <span>Type</span>
                    <Select
                        name="kind"
                        value={kind ?? ""}
                        ariaLabel="Filter by document type"
                        onChange={(value) => apply({ kind: value })}
                        options={[
                            { value: "", label: "All types" },
                            ...kinds.map((option) => ({
                                value: option.kind,
                                label: `${documentKindLabel(option.kind)} (${option.count})`,
                            })),
                        ]}
                    />
                </div>

                <div className={styles.filterField}>
                    <span>Person</span>
                    <Select
                        name="person"
                        value={person ?? ""}
                        ariaLabel="Filter by person"
                        onChange={(value) => apply({ person: value })}
                        options={[
                            { value: "", label: "Anyone" },
                            ...people.map((option) => ({
                                value: option.id,
                                label: `${option.name} (${option.count})`,
                            })),
                        ]}
                    />
                </div>

                <div className={styles.filterField}>
                    <span>Capacity</span>
                    <Select
                        name="role"
                        value={role ?? ""}
                        ariaLabel="Filter by capacity"
                        onChange={(value) => apply({ role: value })}
                        options={[
                            { value: "", label: "Any capacity" },
                            ...roles.map((option) => ({
                                value: option.role,
                                label: `${contributorRoleLabel(option.role)} (${option.count})`,
                            })),
                        ]}
                    />
                </div>

                {offices.length > 0 && (
                    <div className={styles.filterField}>
                        <span>Office</span>
                        <Select
                            name="office"
                            value={office ?? ""}
                            ariaLabel="Filter by office"
                            onChange={(value) => apply({ office: value })}
                            options={[
                                { value: "", label: "Any office" },
                                ...offices.map((option) => ({
                                    value: option.id,
                                    label: `${option.name} (${option.count})`,
                                })),
                            ]}
                        />
                    </div>
                )}
            </div>

            <noscript>
                <button type="submit" className={styles.fallbackButton}>
                    Search
                </button>
            </noscript>

            <span
                aria-live="polite"
                className={`${styles.status} ${pending ? "" : styles.hidden}`}
            >
                Filtering…
            </span>
        </form>
    );
}
