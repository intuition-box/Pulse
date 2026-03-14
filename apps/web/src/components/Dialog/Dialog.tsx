"use client";

import type { ReactNode } from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { IconButton } from "@/components/IconButton/IconButton";
import styles from "./Dialog.module.css";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position?: "center" | "right";
  width?: number;
  title?: string;
  ariaLabel?: string;
  headerExtra?: ReactNode;
  closeButtonSize?: "sm" | "md";
  bodyClassName?: string;
  children: ReactNode;
};

const DEFAULT_WIDTH = { center: 780, right: 420 } as const;

export function Dialog({
  open,
  onOpenChange,
  position = "center",
  width,
  title,
  ariaLabel,
  headerExtra,
  closeButtonSize = "sm",
  bodyClassName,
  children,
}: DialogProps) {
  const resolvedWidth = width ?? DEFAULT_WIDTH[position];
  const hasHeader = !!title;

  const contentClass = [
    styles.content,
    position === "center" ? styles.contentCenter : styles.contentRight,
  ].join(" ");

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          className={contentClass}
          style={{ width: resolvedWidth }}
          aria-label={!title ? ariaLabel : undefined}
          {...(bodyClassName ? { "data-no-body-scroll": "" } : {})}
        >
          {hasHeader ? (
            <div className={styles.header}>
              <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
              {headerExtra && <div className={styles.headerExtra}>{headerExtra}</div>}
              <RadixDialog.Close asChild>
                <IconButton icon={X} size={closeButtonSize} label="Close" />
              </RadixDialog.Close>
            </div>
          ) : (
            <>
              <RadixDialog.Title className={styles.srOnly}>
                {ariaLabel || "Dialog"}
              </RadixDialog.Title>
              <div className={styles.floatingClose}>
                <RadixDialog.Close asChild>
                  <IconButton icon={X} size={closeButtonSize} label="Close" />
                </RadixDialog.Close>
              </div>
            </>
          )}
          <div className={[styles.body, bodyClassName].filter(Boolean).join(" ")}>{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
