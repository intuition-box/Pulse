"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { labels } from "@/lib/vocabulary";
import { asNumber } from "@/lib/format/asNumber";
import styles from "./ThemePicker.module.css";

type ThemeOption = { slug: string; name: string };

type AtomSuggestion = {
  id: string;
  label: string;
  source: "global" | "semantic" | "graphql";
  marketCap: number | null;
  holders: number | null;
};

type ThemePickerProps = {
  /** Already selected themes (excluded from suggestions). */
  selected: ThemeOption[];
  /** Called when user picks an existing DB theme. */
  onPickTheme: (theme: ThemeOption) => void;
  /** Called when user picks an Intuition atom (creates theme in DB with atomTermId). */
  onLinkAtom: (atom: { id: string; label: string }) => void;
  /** Called when user clicks "Create new" (on-chain atom creation). */
  onCreateNew?: (name: string) => void;
  placeholder?: string;
  creating?: boolean;
};

function parseSuggestions(value: unknown): AtomSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const { id, label, source, marketCap, holders } = item as Record<string, unknown>;
      if (typeof id !== "string" || typeof label !== "string") return null;
      if (source !== "global" && source !== "semantic" && source !== "graphql") return null;
      return { id, label, source, marketCap: asNumber(marketCap), holders: asNumber(holders) };
    })
    .filter((item): item is AtomSuggestion => item !== null);
}

function formatMetric(value: number | null | undefined, maxFractionDigits = 2) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function formatAtomId(value: string) {
  if (value.length <= 12) return value;
  const pre = value.startsWith("0x") ? 7 : 6;
  return `${value.slice(0, pre)}…${value.slice(-4)}`;
}

export function ThemePicker({
  selected,
  onPickTheme,
  onLinkAtom,
  onCreateNew,
  placeholder = "Search or create a theme…",
  creating,
}: ThemePickerProps) {
  const [allThemes, setAllThemes] = useState<ThemeOption[]>([]);
  const [query, setQuery] = useState("");
  const [atomResults, setAtomResults] = useState<AtomSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/themes")
      .then((r) => r.json())
      .then((data) => setAllThemes(data.themes ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < 2) {
      setAtomResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/intuition/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed, limit: 5 }),
          signal: controller.signal,
        });
        if (!res.ok) { setAtomResults([]); return; }
        const data = await res.json();
        setAtomResults(parseSuggestions(data.suggestions));
      } catch {
        if (!controller.signal.aborted) setAtomResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [trimmed]);

  const lowerQuery = trimmed.toLowerCase();
  const selectedSlugs = useMemo(() => new Set(selected.map((t) => t.slug)), [selected]);

  const filteredThemes = useMemo(
    () =>
      allThemes.filter(
        (t) =>
          (!lowerQuery || t.name.toLowerCase().includes(lowerQuery)) &&
          !selectedSlugs.has(t.slug),
      ),
    [allThemes, lowerQuery, selectedSlugs],
  );

  const dbNames = useMemo(() => new Set(allThemes.map((t) => t.name.toLowerCase())), [allThemes]);
  const filteredAtoms = useMemo(
    () => atomResults.filter((a) => !dbNames.has(a.label.toLowerCase())),
    [atomResults, dbNames],
  );

  const exactMatch =
    allThemes.some((t) => t.name.toLowerCase() === lowerQuery) ||
    atomResults.some((a) => a.label.toLowerCase() === lowerQuery);
  const showCreate = trimmed.length >= 2 && !exactMatch && !searching && !!onCreateNew;

  const handlePickTheme = useCallback(
    (theme: ThemeOption) => {
      onPickTheme(theme);
      setQuery("");
    },
    [onPickTheme],
  );

  const handleLinkAtom = useCallback(
    (atom: AtomSuggestion) => {
      onLinkAtom({ id: atom.id, label: atom.label });
      setQuery("");
    },
    [onLinkAtom],
  );

  const hasResults = filteredThemes.length > 0 || filteredAtoms.length > 0 || showCreate || searching;

  return (
    <div className={styles.container}>
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
      />

      <div className={styles.results}>
        {/* DB themes */}
        {filteredThemes.length > 0 && (
          <div className={styles.section}>
            {filteredThemes.map((t) => (
              <button
                key={t.slug}
                type="button"
                className={styles.themeOption}
                onClick={() => handlePickTheme(t)}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}

        {/* Intuition atoms */}
        {filteredAtoms.length > 0 && (
          <div className={styles.section}>
            {filteredThemes.length > 0 && <div className={styles.divider} />}
            <div className={styles.sectionLabel}>On-chain atoms</div>
            {filteredAtoms.map((a) => (
              <button
                key={a.id}
                type="button"
                className={styles.atomCard}
                onClick={() => handleLinkAtom(a)}
                disabled={creating}
              >
                <span className={styles.atomLabel}>{a.label}</span>
                {(a.marketCap != null || a.holders != null) && (
                  <div className={styles.atomMetrics}>
                    {a.marketCap != null && (
                      <span className={styles.metric}>
                        <span className={styles.metricLabel}>{labels.metricStaked}</span>
                        <span className={styles.metricValue}>{formatMetric(a.marketCap, 3)}</span>
                      </span>
                    )}
                    {a.holders != null && (
                      <span className={styles.metric}>
                        <span className={styles.metricLabel}>{labels.metricParticipants}</span>
                        <span className={styles.metricValue}>{formatMetric(a.holders, 0)}</span>
                      </span>
                    )}
                  </div>
                )}
                <div className={styles.atomBottom}>
                  <span className={styles.atomSource}>{a.source}</span>
                  <span className={styles.atomId} title={a.id}>{formatAtomId(a.id)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Searching indicator */}
        {searching && filteredThemes.length === 0 && filteredAtoms.length === 0 && (
          <div className={styles.hint}>Searching…</div>
        )}

        {/* No results */}
        {!searching && !hasResults && trimmed.length >= 2 && (
          <div className={styles.hint}>No results.</div>
        )}

        {/* Create new */}
        {showCreate && (
          <button
            type="button"
            className={styles.createOption}
            onClick={() => { onCreateNew!(trimmed); setQuery(""); }}
            disabled={creating}
          >
            <span className={styles.createIcon}>+</span>
            <span className={styles.createText}>
              {creating ? "Creating…" : <>Create &quot;<strong>{trimmed}</strong>&quot; as new atom</>}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
