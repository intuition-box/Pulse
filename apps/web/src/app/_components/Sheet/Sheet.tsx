"use client";

import { ReactNode } from "react";

import { Dialog } from "@/components/Dialog/Dialog";

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
};

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: SheetProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      position="right"
      title={title}
      closeButtonSize="md"
    >
      {children}
    </Dialog>
  );
}
