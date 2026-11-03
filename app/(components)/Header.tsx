import Image from "next/image";
import Link from "next/link";

import { getSessionString } from "../utils";
import MainNav from "./MainNav";
import styles from "./Header.module.css";

export default function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link className={styles.identity} href="/" aria-label="JHU SGA home">
          <Image
            src="/logo.png"
            alt=""
            width={52}
            height={52}
            draggable={false}
            className={styles.logo}
            priority
          />
          <span className={styles.wordmark}>
            <span>JHU SGA</span>
            <small>The {getSessionString()} Session</small>
          </span>
        </Link>

        <p className={styles.notice}>
          This website is not official. Visit the official site{" "}
          <a
            href="https://jhu.campusgroups.com/sga/home"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Official SGA site (opens in a new tab)"
          >
            here <span aria-hidden="true">&#8599;</span>
          </a>
          .
        </p>

        <MainNav />
      </div>
    </header>
  );
}
