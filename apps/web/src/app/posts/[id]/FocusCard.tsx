import type { ReactNode } from "react";

import { ProtocolBadge } from "@/components/ProtocolBadge/ProtocolBadge";
import { ThemeBadge } from "@/components/ThemeBadge/ThemeBadge";

import styles from "./FocusCard.module.css";

type FocusCardProps = {
  post: {
    body: string;
    tripleLinks: { termId: string; role: string }[];
  };
  themeName: string;
  onOpenInspector: () => void;
  thumbSlot?: ReactNode;
  children?: ReactNode;
};

export function FocusCard({
  post,
  themeName,
  onOpenInspector,
  thumbSlot,
  children,
}: FocusCardProps) {
  return (
    <section className={styles.card}>
      <ThemeBadge>{themeName}</ThemeBadge>
      <p className={styles.body}>{post.body}</p>
      {thumbSlot}
      {children}
      {post.tripleLinks.length > 0 && (
        <ProtocolBadge onClick={onOpenInspector} className={styles.badgePosition}>
          INSPECTOR
        </ProtocolBadge>
      )}
    </section>
  );
}
