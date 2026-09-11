"use client";

import { useEffect, useState } from "react";
import { VideoAscii } from "react-video-ascii";

import styles from "@/app/home.module.css";

/**
 * Converts the supplied blue jay footage into the hero's live ASCII field.
 * Visitors who request reduced motion receive a still blue field instead.
 */
export default function BlueJayAsciiVideo() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(preference.matches);

    updatePreference();
    preference.addEventListener("change", updatePreference);

    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  return (
    <div className={styles.videoStage} aria-hidden="true">
      {!reduceMotion && (
        <VideoAscii
          src="/bluejay.mp4"
          className={styles.asciiVideo}
          numColsRaw={210}
          brightnessRaw={1.12}
          saturationRaw={1.3}
          bgOpacityRaw={0.16}
          chars=" .,:;irsXA253hMHGS#9B&@"
          charMode="luminance"
          mouseEffect={true}
          clickEffect={false}
        />
      )}
    </div>
  );
}
