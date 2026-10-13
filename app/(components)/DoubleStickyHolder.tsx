"use client";

import { useEffect, useRef } from "react";

/**
 * Lets a sidebar taller than the screen be read with the page's own scrollbar.
 *
 * The sticky parent must be clipped to the viewport (max-height + overflow
 * hidden). Once it has stuck, page-scroll movement is copied onto the inner
 * contents until their far edge lines up with the window.
 *
 * The copy happens in the scroll handler itself. Waiting for an animation
 * frame leaves the contents a paint behind the page, and that one-frame lag
 * reads as the inner column stuttering while the document moves smoothly.
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
    const followRef = useRef(false);
    const maxNegativeRef = useRef(0);

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

        /**
         * Whether the sidebar is pinned at this moment -- not merely whether
         * the page has scrolled past the point where it pins.
         *
         * A sticky element only holds its stick point while the column it sits
         * in lasts. At the foot of a page it runs out and leaves the top of the
         * window with everything else, which puts its top *above* the stick
         * point rather than below it. Asking only whether the top had got past
         * the stick point read that as still pinned, so the contents went on
         * being shifted after the frame holding them had begun to leave: the
         * visible region grew as the sidebar rose, the floor the offset is
         * clamped to rose with it, and the last line of the sidebar slid back
         * out of reach exactly as fast as a reader scrolled down after it.
         */
        function isPinned(sidebar: HTMLElement) {
            const top = sidebar.getBoundingClientRect().top;
            return Math.abs(top - stickTopPx(sidebar)) <= 2;
        }

        /**
         * Layout is read here, never in the scroll handler. The handler only
         * subtracts the scroll delta from the offset, which stays on the
         * compositor and tracks the page one-for-one.
         */
        function measure() {
            frameRef.current = null;
            const selfEl = selfRef.current;
            const innerEl = innerRef.current;
            if (!selfEl || !innerEl) return;

            const sidebar = selfEl.parentElement;
            if (!sidebar || getComputedStyle(sidebar).position !== "sticky") {
                followRef.current = false;
                applyOffset(0);
                return;
            }

            const windowHeight = window.innerHeight;
            const childHeight = innerEl.offsetHeight;
            const pageHeight = document.documentElement.scrollHeight;
            const selfTop = selfEl.getBoundingClientRect().top;
            const visibleRegion = windowHeight - selfTop - bottomGap;
            const overflowsViewport =
                childHeight > visibleRegion &&
                childHeight < pageHeight - bottomGap * 2;
            const pinned = isPinned(sidebar);

            followRef.current = pinned && overflowsViewport;
            maxNegativeRef.current = visibleRegion - childHeight;

            if (!followRef.current) return;

            // A resize can open more of the column than the current shift
            // still fills, or shrink the room the shift is allowed.
            if (childHeight + offsetRef.current < visibleRegion) {
                applyOffset(0);
                return;
            }
            if (offsetRef.current < maxNegativeRef.current) {
                applyOffset(maxNegativeRef.current);
            }
        }

        function onScroll() {
            const scrollY = window.scrollY;
            const delta = scrollY - lastScrollYRef.current;
            lastScrollYRef.current = scrollY;

            // Back at the top the column is in flow again, so a later scroll
            // must not spend the distance that happened while it was unpinned.
            if (scrollY <= 0) {
                followRef.current = false;
                applyOffset(0);
                return;
            }

            if (followRef.current && delta !== 0) {
                let next = offsetRef.current - delta;
                if (delta < 0) next = Math.min(next, 0);
                else next = Math.max(next, maxNegativeRef.current);
                applyOffset(next);
            }

            if (frameRef.current === null) {
                frameRef.current = requestAnimationFrame(measure);
            }
        }

        lastScrollYRef.current = window.scrollY;
        measure();
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", measure);

        const sidebar = self.parentElement;
        const observer = new ResizeObserver(measure);
        observer.observe(inner);
        if (sidebar) observer.observe(sidebar);

        return () => {
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", measure);
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
