"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

import { IconButton } from "@/components/IconButton/IconButton";
import styles from "./RightPanel.module.css";

type RightPanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

export function RightPanel({ open, onClose, title, children }: RightPanelProps) {
  if (!open) return null;

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <IconButton icon={X} size="md" label="Close panel" onClick={onClose} />
      </div>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}
