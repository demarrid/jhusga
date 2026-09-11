"use client";

import { useEffect, useRef } from "react";

/**
 * Lets a sidebar taller than the screen be read with the page's own scrollbar.
 *
 * The sticky parent must be clipped to the viewport (max-height + overflow
 * hidden). Once it has stuck, page-scroll movement is copied onto the inner
 * contents until their far edge lines up with the window.
 */
export default function DoubleStickyHolder({
    children,
}: {
    children: React.ReactNode;
}) {
    const selfRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const offsetRef = useRef(0);
    const lastScrollYRef = useRef(0);
    const frameRef = useRef<number | null>(null);

    useEffect(() => {
        const self = selfRef.current;
        const inner = innerRef.current;
        if (!self || !inner) return;

        const bottomGap = 32;

        function applyOffset(value: number) {
            if (value === offsetRef.current) return;
            offsetRef.current = value;
            if (innerRef.current) {
                innerRef.current.style.transform =
                    value === 0 ? "" : `translate3d(0, ${value}px, 0)`;
            }
        }

        function stickTopPx(sidebar: HTMLElement) {
            const raw = getComputedStyle(sidebar).top;
            const value = parseFloat(raw);
            if (!Number.isFinite(value)) return 104;
            if (raw.endsWith("rem")) {
                return value * parseFloat(getComputedStyle(document.documentElement).fontSize);
            }
            return value;
        }

        function update() {
            frameRef.current = null;
            const selfEl = selfRef.current;
            const innerEl = innerRef.current;
            if (!selfEl || !innerEl) return;

            const sidebar = selfEl.parentElement;
            if (!sidebar || getComputedStyle(sidebar).position !== "sticky") {
                applyOffset(0);
                return;
            }

            const scrollY = window.scrollY;
            if (scrollY <= 0) {
                applyOffset(0);
                lastScrollYRef.current = scrollY;
                return;
            }

            const delta = scrollY - lastScrollYRef.current;
            lastScrollYRef.current = scrollY;

            const windowHeight = window.innerHeight;
            const childHeight = innerEl.offsetHeight;
            const pageHeight = document.documentElement.scrollHeight;
            const selfTop = selfEl.getBoundingClientRect().top;
            const pinnedAt = stickTopPx(sidebar);

            const hasScrolledPastStickPoint =
                sidebar.getBoundingClientRect().top <= pinnedAt + 2;
            const visibleRegion = windowHeight - selfTop - bottomGap;
            const overflowsViewport =
                childHeight > visibleRegion &&
                childHeight < pageHeight - bottomGap * 2;

            if (!hasScrolledPastStickPoint || !overflowsViewport) {
                // Delta is still consumed above so there is no catch-up jump
                // the moment scrolling hands off to this component.
                return;
            }

            const maxNegative = visibleRegion - childHeight;
            let next = offsetRef.current - delta;
            if (delta < 0) {
                next = Math.min(next, 0);
            } else {
                next = Math.max(next, maxNegative);
            }
            applyOffset(next);
        }

        function scheduleUpdate() {
            if (frameRef.current !== null) return;
            frameRef.current = requestAnimationFrame(update);
        }

        lastScrollYRef.current = window.scrollY;
        window.addEventListener("scroll", scheduleUpdate, { passive: true });
        window.addEventListener("resize", scheduleUpdate);

        const sidebar = self.parentElement;
        const observer = new ResizeObserver(() => {
            scheduleUpdate();
            const innerEl = innerRef.current;
            const selfEl = selfRef.current;
            if (!innerEl || !selfEl) return;

            const visibleRegion =
                window.innerHeight - selfEl.getBoundingClientRect().top - bottomGap;
            if (innerEl.offsetHeight + offsetRef.current < visibleRegion) {
                applyOffset(0);
                return;
            }
            const maxNegative = visibleRegion - innerEl.offsetHeight;
            if (offsetRef.current < maxNegative) {
                applyOffset(maxNegative);
            }
        });
        observer.observe(inner);
        if (sidebar) observer.observe(sidebar);

        return () => {
            window.removeEventListener("scroll", scheduleUpdate);
            window.removeEventListener("resize", scheduleUpdate);
            observer.disconnect();
            if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        };
    }, []);

    return (
        <div ref={selfRef}>
            <div ref={innerRef} style={{ willChange: "transform" }}>
                {children}
            </div>
        </div>
    );
}
