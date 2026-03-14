import type { ReactNode } from "react";
import { Lightbulb, Info, AlertTriangle } from "lucide-react";
import styles from "./InfoHint.module.css";

type Variant = "tip" | "info" | "warning";

const ICON_MAP: Record<Variant, ReactNode> = {
  tip: <Lightbulb size={14} />,
  info: <Info size={14} />,
  warning: <AlertTriangle size={14} />,
};

type InfoHintProps = {
  variant?: Variant;
  children: ReactNode;
};

export function InfoHint({ variant = "tip", children }: InfoHintProps) {
  return (
    <div className={`${styles.hint} ${styles[variant]}`}>
      <span className={styles.icon} aria-hidden="true">{ICON_MAP[variant]}</span>
      <span>{children}</span>
    </div>
  );
}
