import type { CSSProperties } from "react";

import styles from "./LoadingBar.module.css";

/**
 * The thin bar that says the server is working.
 *
 * An indeterminate sweep by default. Given a progress between 0 and 1 it fills
 * to that point instead, for a wait whose length is known. Hidden rather than
 * removed when idle, so starting a load does not shift the layout below it.
 */
export default function LoadingBar({
    active,
    progress = null,
    className,
}: {
    active: boolean;
    progress?: number | null;
    className?: string;
}) {
    const determinate = active && progress !== null;

    return (
        <div
            className={[
                styles.track,
                active ? styles.loading : "",
                determinate ? styles.determinate : "",
                className ?? "",
            ]
                .filter(Boolean)
                .join(" ")}
            style={determinate ? ({ "--reading-progress": progress } as CSSProperties) : undefined}
            aria-hidden="true"
        >
            <span />
        </div>
    );
}
