"use client";

import Link from "next/link";
import { documentSearchHref } from "@/lib/document-navigation";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";

/** Carry the exact search/filter/mode URL into a result's document page. */
export default function DocumentSearchLink(props: ComponentProps<typeof Link>) {
    const pathname = usePathname();
    const params = useSearchParams();
    const search = params.toString();
    const returnTo = search ? `/documents?${search}` : "/documents";
    const href = pathname === "/documents" && typeof props.href === "string"
        ? documentSearchHref(props.href, returnTo, params.get("q") ?? "") : props.href;
    return <Link {...props} href={href} />;
}
