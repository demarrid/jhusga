"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useTransition, type ReactNode } from "react";

type DocumentQuery = {
    /** True from a change to the filters until the new listing arrives. */
    pending: boolean;
    /** Set or clear query parameters; an empty value removes the parameter. */
    apply: (changes: Record<string, string>) => void;
};

const DocumentQueryContext = createContext<DocumentQuery | null>(null);

/**
 * The documents page's query string, shared between the filters and the list.
 *
 * The URL is the state: a filter or a sort is a navigation, so a result set
 * is always a linkable address. Held here rather than in the filters so the
 * list below them can show the wait for its first page, which the filters'
 * own transition would otherwise keep to itself.
 */
export function DocumentQueryProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [pending, startTransition] = useTransition();

    // The URL only changes once a navigation lands, so a second change made
    // while the first is in flight builds on what was asked for rather than
    // on the address bar, and does not quietly undo the first.
    const requested = useRef<string | null>(null);

    useEffect(() => {
        if (!pending) requested.current = null;
    }, [pending]);

    function apply(changes: Record<string, string>) {
        const params = new URLSearchParams(requested.current ?? window.location.search);

        for (const [key, value] of Object.entries(changes)) {
            if (value) params.set(key, value);
            else params.delete(key);
        }

        const search = params.toString();
        requested.current = search;

        // replace, not push: the back button should leave the listing, not
        // walk back through every filter the reader tried.
        startTransition(() => {
            router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
        });
    }

    return (
        <DocumentQueryContext.Provider value={{ pending, apply }}>
            {children}
        </DocumentQueryContext.Provider>
    );
}

export function useDocumentQuery(): DocumentQuery {
    const query = useContext(DocumentQueryContext);
    if (!query) throw new Error("useDocumentQuery needs a DocumentQueryProvider above it");
    return query;
}
