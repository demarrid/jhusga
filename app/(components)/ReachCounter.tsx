"use client";
import { useEffect } from "react";

// A date is a local deduplication flag, not an identifier. It is never sent.
export default function ReachCounter() {
    useEffect(() => {
        const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
        if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return;
        async function count() {
            try {
                const today = new Date().toISOString().slice(0, 10);
                const key = "sga-counted-day";
                if (localStorage.getItem(key) === today) return;
                // Test storage first: unavailable storage must not count every view.
                localStorage.setItem(key, today);
                const response = await fetch("/api/metrics/reach", { method: "POST", credentials: "omit",
                    referrerPolicy: "no-referrer", keepalive: true });
                if (!response.ok) localStorage.removeItem(key);
            } catch { /* Storage/network restrictions are respected, never bypassed. */ }
        }
        if (navigator.locks) void navigator.locks.request("sga-daily-count", count);
        else void count();
    }, []);
    return null;
}
