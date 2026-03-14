import type { ReactNode } from "react";
import styles from "./ProtocolBadge.module.css";

type ProtocolBadgeProps = {
  onClick?: (e: React.MouseEvent) => void;
  children?: ReactNode;
  className?: string;
};

export function ProtocolBadge({ onClick, children, className }: ProtocolBadgeProps) {
  const classes = [styles.badge, onClick ? styles.clickable : "", className].filter(Boolean).join(" ");

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onClick(e);
        }}
      >
        {children}
      </button>
    );
  }

  return <span className={classes}>{children}</span>;
}
