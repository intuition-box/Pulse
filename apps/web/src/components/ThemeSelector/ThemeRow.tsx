"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Plus, X } from "lucide-react";

import { ThemeBadge } from "@/components/ThemeBadge/ThemeBadge";
import { ThemePicker } from "@/components/ThemePicker/ThemePicker";

import styles from "./ThemeRow.module.css";

type ThemeItem = { slug: string; name: string };

type ThemeRowProps = {
  selected: ThemeItem[];
  onChange: (themes: ThemeItem[]) => void;
  min?: number;
  lockedSlugs?: string[];
  onCreateTheme?: (name: string) => Promise<ThemeItem | null>;
  placeholder?: string;
};

export function ThemeRow({
  selected,
  onChange,
  min = 1,
  lockedSlugs,
  onCreateTheme,
  placeholder,
}: ThemeRowProps) {
  const [showPicker, setShowPicker] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const lockedSet = lockedSlugs ? new Set(lockedSlugs) : null;

  useEffect(() => {
    if (!showPicker) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPicker]);

  function canRemove(slug: string) {
    if (lockedSet?.has(slug)) return false;
    if (selected.length <= min) return false;
    return true;
  }

  function handleRemove(slug: string) {
    if (!canRemove(slug)) return;
    onChange(selected.filter((t) => t.slug !== slug));
  }

  const handlePickTheme = useCallback(
    (theme: ThemeItem) => {
      onChange([...selected, theme]);
      setShowPicker(false);
    },
    [selected, onChange],
  );

  const handleLinkAtom = useCallback(
    async (atom: { id: string; label: string }) => {
      try {
        const res = await fetch("/api/themes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: atom.label, atomTermId: atom.id }),
        });
        if (!res.ok) return;
        const created: ThemeItem = await res.json();
        onChange([...selected, { slug: created.slug, name: created.name }]);
        setShowPicker(false);
      } catch {
      }
    },
    [selected, onChange],
  );

  const handleCreateNew = useCallback(
    async (name: string) => {
      if (!onCreateTheme) return;
      const result = await onCreateTheme(name);
      if (result) {
        onChange([...selected, result]);
        setShowPicker(false);
      }
    },
    [selected, onChange, onCreateTheme],
  );

  return (
    <div className={styles.row}>
      {selected.map((t) => (
        <span key={t.slug} className={styles.chip}>
          <ThemeBadge size="sm" slug={t.slug}>{t.name}</ThemeBadge>
          {canRemove(t.slug) && (
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => handleRemove(t.slug)}
              aria-label={`Remove ${t.name}`}
            >
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      <div className={styles.addWrapper} ref={popoverRef}>
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={() => setShowPicker(!showPicker)}
          aria-label="Add theme"
        >
          {selected.length === 0 && <span className={styles.ghostLabel}>Add theme</span>}
          <Plus size={12} />
        </button>
        {showPicker && (
          <div className={styles.popover}>
            <ThemePicker
              selected={selected}
              onPickTheme={handlePickTheme}
              onLinkAtom={handleLinkAtom}
              onCreateNew={onCreateTheme ? handleCreateNew : undefined}
              placeholder={placeholder ?? "Search or create a theme…"}
            />
          </div>
        )}
      </div>
    </div>
  );
}
