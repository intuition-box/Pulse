import type { HTMLAttributes } from "react";

import styles from "./Badge.module.css";

export type BadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "supports"
  | "refutes"
  | "theme"
  | "streak";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  animated?: boolean;
};

export function Badge({
  tone = "neutral",
  animated,
  className,
  children,
  ...props
}: BadgeProps) {
  const classes = [styles.badge, styles[tone], animated && styles.animated, className].filter(Boolean).join(" ");

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}
