import type { ReactNode } from "react";

import styles from "./discussion.module.css";

/**
 * A footer disclaimer for every discussion route.
 *
 * The forum is a public wall for whoever signs in with a Hopkins address, and
 * a reader landing on any thread has no way of knowing that what one poster
 * wrote is not something the SGA has said. This line makes it hard to miss:
 * that everything under this route is somebody at Hopkins, not the SGA or the
 * University, and that reading it as either would be a mistake.
 *
 * Lives in a layout rather than each page so posts, replies, the composer,
 * the moderation log, and the rules page all print it in the same place.
 */
export default function DiscussionLayout({ children }: { children: ReactNode }) {
    return (
        <div className={styles.discussionRoot}>
            {children}
            <footer className={styles.disclaimer} role="contentinfo">
                <p>
                    Any claims or opinions made herein represent in no way
                    those of members of the SGA or the University.
                </p>
            </footer>
        </div>
    );
}
