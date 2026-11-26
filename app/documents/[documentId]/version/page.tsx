import type { Metadata } from "next";

import { DocumentPageBody, documentMetadata, queryValue } from "../document-page";

/*
 * A chosen saved version, or a page opened with version history showing.
 *
 * Readers reach this through `/documents/<id>?version=…` or `?diff=1`, which
 * proxy.ts rewrites here; the address bar keeps the original URL. It renders on
 * request because the query decides what it shows. The plain document URL is
 * the cached ../page.tsx.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: PageProps<"/documents/[documentId]/version">): Promise<Metadata> {
    const { documentId } = await params;
    const { version } = await searchParams;
    return documentMetadata({ documentId, version: queryValue(version) });
}

export default async function DocumentVersionPage({ params, searchParams }: PageProps<"/documents/[documentId]/version">) {
    const { documentId } = await params;
    const { version, diff } = await searchParams;
    return <DocumentPageBody documentId={documentId} version={queryValue(version)} comparing={queryValue(diff) === "1"} />;
}
