/** Keep the return link inside the document listing, never an external URL. */
export function documentReturnPath(value: string | string[] | undefined): string | null {
    if (typeof value !== "string") return null;
    if (value !== "/documents" && !value.startsWith("/documents?")) return null;
    if (/[\r\n\\]/.test(value)) return null;
    return value;
}

/** Keep query strings and citation anchors intact when opening a search result. */
export function documentSearchHref(href: string, returnTo: string, query: string): string {
    const url = new URL(href, 'https://archive.invalid');
    url.searchParams.set('returnTo', returnTo);
    if (query) url.searchParams.set('q', query);
    return `${url.pathname}${url.search}${url.hash}`;
}
