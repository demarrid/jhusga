"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { documentReturnPath } from "@/lib/document-navigation";

/*
 * The return-to-search state lives only in the address bar, and is read here in
 * the browser rather than on the server, so the document page can stay cached:
 * a search result's `?returnTo=` must not make every visit a fresh render.
 *
 * Each link renders without the return path first (the cached HTML), then
 * picks it up once the browser has the URL.
 */

function useReturnTo(): string | null {
    return documentReturnPath(useSearchParams().get("returnTo") ?? undefined);
}

function BackLink({ className, returnTo }: { className?: string; returnTo: string | null }) {
    return (
        <Link className={className} href={returnTo ?? "/documents"}>
            {returnTo ? "← Back to search" : "← All documents"}
        </Link>
    );
}

function BackLinkFromUrl({ className }: { className?: string }) {
    return <BackLink className={className} returnTo={useReturnTo()} />;
}

/** "← Back to search" when the reader came from one, else "← All documents". */
export function DocumentBackLink({ className }: { className?: string }) {
    return (
        <Suspense fallback={<BackLink className={className} returnTo={null} />}>
            <BackLinkFromUrl className={className} />
        </Suspense>
    );
}

type VersionLinkProps = {
    documentId: string;
    versionId: string;
    scroll?: boolean;
    children: ReactNode;
};

function versionHref(documentId: string, versionId: string, returnTo: string | null): string {
    const query = new URLSearchParams({ version: versionId, ...(returnTo ? { returnTo } : {}) });
    return `/documents/${documentId}?${query}`;
}

function VersionLinkFromUrl({ documentId, versionId, scroll, children }: VersionLinkProps) {
    return <Link href={versionHref(documentId, versionId, useReturnTo())} scroll={scroll}>{children}</Link>;
}

/** A link to one saved version that keeps the reader's way back to search. */
export function DocumentVersionLink(props: VersionLinkProps) {
    const { documentId, versionId, scroll, children } = props;
    return (
        <Suspense fallback={<Link href={versionHref(documentId, versionId, null)} scroll={scroll}>{children}</Link>}>
            <VersionLinkFromUrl {...props} />
        </Suspense>
    );
}
