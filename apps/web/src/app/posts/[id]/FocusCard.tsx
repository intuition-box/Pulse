"use client";

import { useState, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { Plus, Loader2 } from "lucide-react";

import { ProtocolBadge } from "@/components/ProtocolBadge/ProtocolBadge";
import { ThemeBadge } from "@/components/ThemeBadge/ThemeBadge";
import { ThemePicker } from "@/components/ThemePicker/ThemePicker";

import styles from "./FocusCard.module.css";

type ThemeItem = { slug: string; name: string };

type FocusCardProps = {
  post: {
    id: string;
    body: string;
    tripleLinks: { termId: string; role: string }[];
  };
  themes: ThemeItem[];
  onAddTheme?: (theme: ThemeItem) => Promise<boolean>;
  onLinkAtom?: (atom: { id: string; label: string }) => void;
  onCreateTheme?: (name: string) => void;
  isAddingTheme?: boolean;
  addThemeError?: string | null;
  onOpenInspector: () => void;
  thumbSlot?: ReactNode;
  children?: ReactNode;
};

export function FocusCard({
  post,
  themes,
  onAddTheme,
  onLinkAtom,
  onCreateTheme,
  isAddingTheme,
  addThemeError,
  onOpenInspector,
  thumbSlot,
  children,
}: FocusCardProps) {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPicker]);

  async function handlePickTheme(theme: ThemeItem) {
    if (onAddTheme) {
      const ok = await onAddTheme(theme);
      if (ok) setShowPicker(false);
    }
  }

  function handleLinkAtom(atom: { id: string; label: string }) {
    onLinkAtom?.(atom);
    setShowPicker(false);
  }

  return (
    <section className={styles.card}>
      <div className={styles.themeRow}>
        {themes.map((t) => (
          <ThemeBadge key={t.slug} slug={t.slug}>{t.name}</ThemeBadge>
        ))}
        {onAddTheme && (
          <div className={styles.addThemeWrapper} ref={pickerRef}>
            <button
              type="button"
              className={styles.addThemeBtn}
              onClick={() => setShowPicker(!showPicker)}
              aria-label="Add theme"
              disabled={isAddingTheme}
            >
              {isAddingTheme ? <Loader2 size={14} className={styles.spin} /> : <Plus size={14} />}
            </button>
            {showPicker && (
              <div className={styles.selectorPopover}>
                <ThemePicker
                  selected={themes}
                  onPickTheme={handlePickTheme}
                  onLinkAtom={handleLinkAtom}
                  onCreateNew={onCreateTheme}
                  creating={isAddingTheme}
                  placeholder="Add a theme…"
                />
                {addThemeError && (
                  <p className={styles.error}>{addThemeError}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
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
