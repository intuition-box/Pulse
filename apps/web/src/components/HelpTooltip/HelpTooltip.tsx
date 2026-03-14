"use client";

import { type ReactElement, type ReactNode, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import styles from "./HelpTooltip.module.css";

type HelpTooltipProps = {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
};

export function HelpTooltip({ content, children, side = "bottom" }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const isTouchRef = useRef(false);

  return (
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger
        asChild
        onPointerDown={(e) => { isTouchRef.current = e.pointerType === "touch"; }}
        onClick={(e) => {
          if (isTouchRef.current) {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className={styles.content}
          side={side}
          sideOffset={8}
          align="center"
          collisionPadding={8}
          onEscapeKeyDown={() => setOpen(false)}
          onPointerDownOutside={() => setOpen(false)}
        >
          {content}
          <Tooltip.Arrow className={styles.arrow} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
