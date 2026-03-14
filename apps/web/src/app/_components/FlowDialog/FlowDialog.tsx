"use client";

import { ReactNode } from "react";

import { Dialog } from "@/components/Dialog/Dialog";
import { HelpTooltip } from "@/components/HelpTooltip/HelpTooltip";
import styles from "./FlowDialog.module.css";

type FlowDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  helpText?: string | null;
  width?: number;
  bodyClassName?: string;
  children: ReactNode;
};

export function FlowDialog({
  open,
  onOpenChange,
  title,
  helpText,
  width,
  bodyClassName,
  children,
}: FlowDialogProps) {
  const helpButton = helpText ? (
    <HelpTooltip content={helpText}>
      <button type="button" className={styles.helpButton} aria-label="Help">?</button>
    </HelpTooltip>
  ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      position="center"
      width={width}
      title={title}
      closeButtonSize="sm"
      headerExtra={helpButton}
      bodyClassName={bodyClassName}
    >
      {children}
    </Dialog>
  );
}
