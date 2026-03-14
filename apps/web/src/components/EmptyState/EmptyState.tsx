import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./EmptyState.module.css";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
};

export function EmptyState({ icon: Icon, title, description, action, compact }: EmptyStateProps) {
  const classes = [styles.emptyState, compact && styles.compact].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      {Icon && <Icon size={compact ? 20 : 32} className={styles.icon} />}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action}
    </div>
  );
}
