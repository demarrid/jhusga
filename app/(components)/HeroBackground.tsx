"use client";

import BlueJayAsciiVideo from "@/app/(components)/BlueJayAsciiVideo";
import { useWebGL } from "@/app/clientutils";
import styles from "@/app/home.module.css";

/**
 * Chooses the hero backdrop once the browser's capabilities are known.
 * The still image renders first and stays put on machines without
 * hardware-accelerated WebGL, where the ASCII field would crawl.
 */
export default function HeroBackground() {
  const hasWebGL = useWebGL();

  if (hasWebGL) {
    return <BlueJayAsciiVideo />;
  }

  return (
    <div className={styles.backgroundImageWrap}>
      <img
        src="/home_background.jpg"
        alt="Gilman Background"
        className={styles.backgroundDimmed}
      />
    </div>
  );
}
