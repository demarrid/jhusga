"use client";
import { useEffect, useState } from "react";
import styles from "./DocumentUpdateBanner.module.css";

export default function DocumentUpdateBanner({ documentId, latestVersionId }: {
    documentId: string;
    latestVersionId: string;
}) {
    const [updated, setUpdated] = useState(false);
    useEffect(() => {
        let active = true;
        void fetch(`/api/documents/${encodeURIComponent(documentId)}/refresh`, {
            method: "POST", cache: "no-store",
        }).then(async response => {
            if (!response.ok) return;
            const result = await response.json();
            if (active && typeof result.latestVersionId === "string") {
                setUpdated(result.latestVersionId !== latestVersionId);
            }
        }).catch(() => {
            // Source outages must not interrupt reading the archived copy.
        });
        return () => { active = false; };
    }, [documentId, latestVersionId]);

    function reload() {
        const url = new URL(window.location.href);
        // Otherwise a dated or explicitly selected old version would stay old.
        url.searchParams.set("version", "latest");
        window.location.assign(url.href);
    }

    return updated ? (
        <div className={styles.banner} role="status">
            This document has been updated.{" "}
            <button type="button" onClick={reload}>
                Reload
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7M20 12a8 8 0 0 0-2.3-5.7" />
                </svg>
            </button>
        </div>
    ) : null;
}
