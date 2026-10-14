"use client";

import Link from "next/link";
import {
    useEffect,
    useState,
    useSyncExternalStore,
    type CSSProperties,
    type FocusEvent,
    type TransitionEvent,
} from "react";

import { ACTIVITY_CARD_LIMIT, type ActivityCard, type ActivityLane } from "@/lib/activity";

import styles from "./RecentCarousel.module.css";

/**
 * How long one lane stays before the next phrase starts upward.
 * The glide itself is the slow part; this is the rest between glides.
 */
const CYCLE_MS = 5_200;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Recent resolutions, meetings, and bills, over the hero.
 *
 * "Recent" stays put. The lane name, and the text inside each card, glide up
 * the way the ask field cycles its examples: a fixed window, the next line
 * waiting just below, then a snap back to the first once the copy has arrived.
 * The cards themselves do not change size.
 */
export default function RecentCarousel({ lanes }: { lanes: ActivityLane[] }) {
    const reducedMotion = usePrefersReducedMotion();
    const [index, setIndex] = useState(0);
    const [animate, setAnimate] = useState(true);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);

    const cycling = lanes.length > 1 && !reducedMotion;
    const slides = cycling ? [...lanes, lanes[0]!] : lanes;
    const running = !hovered && !focused && cycling;
    const shownIndex = cycling ? Math.min(index, lanes.length) : 0;
    const slots = Math.min(
        ACTIVITY_CARD_LIMIT,
        Math.max(0, ...lanes.map((lane) => lane.cards.length)),
    );

    useEffect(() => {
        if (!running) return;

        const timer = window.setInterval(() => {
            setIndex((current) => current >= lanes.length ? 0 : current + 1);
        }, CYCLE_MS);

        return () => window.clearInterval(timer);
    }, [running, lanes.length]);

    function finishLoop(event: TransitionEvent<HTMLUListElement>) {
        if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
        if (!cycling || index !== lanes.length) return;

        setAnimate(false);
        setIndex(0);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => setAnimate(true));
        });
    }

    if (lanes.length === 0 || slots === 0) return null;

    const motion = animate ? styles.glide : `${styles.glide} ${styles.glideInstant}`;
    const shown = slides[shownIndex]?.cards.length ?? 1;

    return (
        <div
            className={styles.carousel}
            style={{ "--lane-index": shownIndex, "--shown": shown } as CSSProperties}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={(event: FocusEvent<HTMLDivElement>) => {
                const next = event.relatedTarget;
                if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocused(false);
            }}
        >
            <div className={styles.plate}>
                <div className={styles.label}>
                    <span className={styles.recentWord}>Recent</span>
                    <span className={styles.currentLane}>
                        {slides[shownIndex]?.label}
                    </span>
                    <span className={styles.wordWindow} aria-hidden="true">
                        <ul className={`${styles.wordTrack} ${motion}`} onTransitionEnd={finishLoop}>
                            {slides.map((lane, position) => (
                                <li key={`${lane.id}-${position}`}>{lane.label}</li>
                            ))}
                        </ul>
                    </span>
                </div>

                <div className={styles.slots}>
                    {Array.from({ length: slots }, (_, slot) => (
                        <div className={styles.card} key={slot}>
                            <ul className={`${styles.cardTrack} ${motion}`}>
                                {slides.map((lane, position) => {
                                    const card = lane.cards[slot];
                                    const current = position === shownIndex;
                                    return (
                                        <li
                                            key={`${lane.id}-${position}`}
                                            aria-hidden={!current}
                                            inert={!current || !card}
                                        >
                                            {card && <CardFace card={card} />}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function CardFace({ card }: { card: ActivityCard }) {
    return (
        <Link href={card.href} className={styles.cardFace}>
            <span className={styles.status}>{card.status}</span>
            <span className={styles.date}>{card.dateLabel}</span>
            <span className={styles.cardTitle}>{card.title}</span>
            <span className={styles.authors}>{card.authors}</span>
        </Link>
    );
}

function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(subscribeToReducedMotion, readReducedMotion, () => false);
}

function subscribeToReducedMotion(onChange: () => void): () => void {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
