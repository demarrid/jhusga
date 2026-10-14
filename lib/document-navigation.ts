/** Keep the return link inside the document listing, never an external URL. */
export function documentReturnPath(value: string | string[] | undefined): string | null {
    if (typeof value !== "string") return null;
    if (value !== "/documents" && !value.startsWith("/documents?")) return null;
    if (/[\r\n\\]/.test(value)) return null;
    return value;
}
