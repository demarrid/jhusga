import type { NextRequest } from "next/server";

import { getDocumentPage } from "@/api/documents";
import { SESSION_NUMBER } from "@/config/session";
import { parseDocumentSort } from "@/lib/document-sort";

/**
 * The next page of the document listing, for infinite scroll.
 *
 * Takes the same query string as /documents, so the listing can hand over its
 * own URL, plus `after` and `offset` from the page before. A GET route rather
 * than a server action: server actions are dispatched one at a time and
 * cannot be cancelled, and a reader who changes the sort mid-scroll should not
 * have to wait out the page they no longer want.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;
    const after = params.get("after");
    const offset = Number(params.get("offset"));
    const query = params.get("q") ?? undefined;

    try {
        const page = await getDocumentPage({
            query,
            kind: params.get("kind") ?? undefined,
            personId: params.get("person") ?? undefined,
            role: params.get("role") ?? undefined,
            officeId: params.get("office") ?? undefined,
            session: params.get("archive") === "1" ? "all" : SESSION_NUMBER,
            sort: parseDocumentSort(params.get("sort"), Boolean(query?.trim())),
            cursor: after
                ? { after, offset: Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0 }
                : null,
        });

        return Response.json(page, { headers: { "Cache-Control": "no-store" } });
    } catch (cause) {
        console.error("Loading a page of the document listing failed", cause);
        return Response.json(
            { error: "The next documents could not be loaded." },
            { status: 500 },
        );
    }
}
