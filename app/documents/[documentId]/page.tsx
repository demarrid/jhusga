import type { Metadata } from "next";

import { DocumentPageBody, documentMetadata } from "./document-page";

/*
 * The latest version of a document, cached (ISR) so repeat visits and crawlers
 * are served without rendering. Archive updates expire it through the
 * `archive-derived` tag its data reads carry (lib/archive-cache.ts), and the
 * data cache's own lifetime bounds how stale it can get after CLI changes.
 *
 * `?version=` and `?diff=` URLs are rewritten to ./version by proxy.ts.
 * Reading searchParams here would make every visit render on request again.
 */
export const revalidate = 3600;

// Nothing is prerendered at build; each document is rendered on its first visit.
export async function generateStaticParams(): Promise<Array<{ documentId: string }>> {
    return [];
}

export async function generateMetadata({ params }: PageProps<"/documents/[documentId]">): Promise<Metadata> {
    const { documentId } = await params;
    return documentMetadata({ documentId });
}

export default async function DocumentPage({ params }: PageProps<"/documents/[documentId]">) {
    const { documentId } = await params;
    return <DocumentPageBody documentId={documentId} />;
}
