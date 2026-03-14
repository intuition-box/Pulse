"use client";

import { useState, useRef, useEffect } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";

import styles from "./BurgerMenu.module.css";

export function BurgerMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className={styles.wrapper} ref={menuRef}>
      <button
        className={styles.burger}
        onClick={() => setOpen(!open)}
        aria-label="Menu"
      >
        <span className={styles.line} />
        <span className={styles.line} />
        <span className={styles.line} />
        <span className={styles.label}>Menu</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <ConnectButton />
          <button className={styles.menuItem} disabled>
            Dashboard
          </button>
        </div>
      )}
    </div>
  );
}
