"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

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
            <label className={styles.queryField}>
                <span>Search documents and people</span>
                <input
                    type="search"
                    name="q"
                    defaultValue={query}
                    placeholder="Title, keyword, or person"
                    onChange={(event) => applyQuery(event.target.value)}
                />
            </label>

            <div className={styles.filterRow}>
                <label className={styles.filterField}>
                    <span>Type</span>
                    <select
                        name="kind"
                        defaultValue={kind ?? ""}
                        onChange={(event) => apply({ kind: event.target.value })}
                    >
                        <option value="">All types</option>
                        {kinds.map((option) => (
                            <option key={option.kind} value={option.kind}>
                                {documentKindLabel(option.kind)} ({option.count})
                            </option>
                        ))}
                    </select>
                </label>

                <label className={styles.filterField}>
                    <span>Person</span>
                    <select
                        name="person"
                        defaultValue={person ?? ""}
                        onChange={(event) => apply({ person: event.target.value })}
                    >
                        <option value="">Anyone</option>
                        {people.map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.name} ({option.count})
                            </option>
                        ))}
                    </select>
                </label>

                <label className={styles.filterField}>
                    <span>Capacity</span>
                    <select
                        name="role"
                        defaultValue={role ?? ""}
                        onChange={(event) => apply({ role: event.target.value })}
                    >
                        <option value="">Any capacity</option>
                        {roles.map((option) => (
                            <option key={option.role} value={option.role}>
                                {contributorRoleLabel(option.role)} ({option.count})
                            </option>
                        ))}
                    </select>
                </label>

                {offices.length > 0 && (
                    <label className={styles.filterField}>
                        <span>Office</span>
                        <select
                            name="office"
                            defaultValue={office ?? ""}
                            onChange={(event) => apply({ office: event.target.value })}
                        >
                            <option value="">Any office</option>
                            {offices.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.name} ({option.count})
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                <label className={styles.archiveToggle}>
                    <input
                        type="checkbox"
                        name="archive"
                        value="1"
                        defaultChecked={archive}
                        onChange={(event) => apply({ archive: event.target.checked ? "1" : "" })}
                    />
                    <span>Include past sessions</span>
                </label>
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
