"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { signOut } from "@/api/auth";

/**
 * Signing out deletes the session row rather than just dropping the cookie,
 * so what is left behind afterwards is nothing at all.
 */
export default function SignOutButton() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    return (
        <button
            type="button"
            disabled={pending}
            className="text-primary-700 underline disabled:opacity-50"
            onClick={() =>
                startTransition(async () => {
                    await signOut();
                    router.refresh();
                })
            }
        >
            {pending ? "Signing out…" : "Sign out"}
        </button>
    );
}
