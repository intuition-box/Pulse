import type { ReactNode } from "react";

import styles from "./ThemeBadge.module.css";

type ThemeBadgeProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
  slug?: string;
};

/** Deterministic hue from a string (0-360) using FNV-1a for better distribution. */
function slugToHue(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 360);
}

export function ThemeBadge({ size = "md", className, children, slug }: ThemeBadgeProps) {
  const classes = [styles.badge, styles[size], className]
    .filter(Boolean)
    .join(" ");
  const hue = slug ? slugToHue(slug) : 220;

  return (
    <span
      className={classes}
      style={{ "--theme-hue": hue } as React.CSSProperties}
    >
      {children}
    </span>
  );
}
