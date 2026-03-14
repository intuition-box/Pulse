"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button/Button";
import { TextInput } from "@/components/TextInput/TextInput";
import { labels } from "@/lib/vocabulary";
import { asNumber } from "@/lib/format/asNumber";
import styles from "./AtomSuggestionInput.module.css";

type Suggestion = {
  id: string;
  label: string;
  source: "global" | "semantic" | "graphql";
  marketCap: number | null;
  holders: number | null;
  shares: number | null;
};

type AtomSuggestionInputProps = {
  id: string;
  label: string;
  value: string;
  lockedAtomId?: string | null;
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onLock: (atomId: string, label: string) => void;
  onUnlock: () => void;
  onCreateNew?: (label: string) => void;
  hideCreateNew?: boolean;
  /** Auto-match confidence (0-1). Orange dot shown when < 0.7 */
  confidence?: number | null;
  /** When false, hides the "Change" button on locked atoms. Default true. */
  allowUnlock?: boolean;
};

const MIN_QUERY_LENGTH = 2;
const PAGE_SIZE = 5;

function parseSuggestions(value: unknown): Suggestion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const { id, label, source, marketCap, holders, shares } = item as {
        id?: unknown;
        label?: unknown;
        source?: unknown;
        marketCap?: unknown;
        holders?: unknown;
        shares?: unknown;
      };
      if (typeof id !== "string" || typeof label !== "string") return null;
      if (source !== "global" && source !== "semantic" && source !== "graphql") return null;
      return {
        id,
        label,
        source,
        marketCap: asNumber(marketCap),
        holders: asNumber(holders),
        shares: asNumber(shares),
      };
    })
    .filter((item): item is Suggestion => item !== null);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function computeSuggestionScore(queryNorm: string, suggestion: Suggestion): number {
  if (!queryNorm) return 0;

  const labelNorm = normalizeSearchText(suggestion.label);
  if (!labelNorm) return 0;

  let score = 0;

  // Match quality first: exact > startsWith > contains
  if (labelNorm === queryNorm) {
    score += 10_000;
  } else if (labelNorm.startsWith(queryNorm)) {
    score += 4_000;
  } else if (labelNorm.includes(queryNorm)) {
    score += 1_500;
  }

  // Token-prefix matches help rank close variants higher.
  const queryTokens = queryNorm.split(" ").filter(Boolean);
  const labelTokens = labelNorm.split(" ").filter(Boolean);
  let tokenPrefixHits = 0;
  for (const token of queryTokens) {
    if (labelTokens.some((labelToken) => labelToken.startsWith(token))) {
      tokenPrefixHits += 1;
    }
  }
  score += tokenPrefixHits * 300;

  // Prefer labels whose length is close to the query.
  const lengthDelta = Math.abs(labelNorm.length - queryNorm.length);
  score += Math.max(0, 200 - lengthDelta * 8);

  // Source confidence (GraphQL exact label query tends to be strongest).
  if (suggestion.source === "graphql") score += 120;
  if (suggestion.source === "global") score += 80;
  if (suggestion.source === "semantic") score += 40;

  // Popularity/usage signals as tie-breakers.
  const marketCap = suggestion.marketCap ?? 0;
  const holders = suggestion.holders ?? 0;
  const shares = suggestion.shares ?? 0;
  if (marketCap > 0) score += Math.log10(marketCap + 1) * 20;
  if (holders > 0) score += Math.log10(holders + 1) * 12;
  if (shares > 0) score += Math.log10(shares + 1) * 8;

  return score;
}

function formatMetric(value?: number | null, maxFractionDigits = 2) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

function formatAtomId(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 12) return trimmed;
  const prefixLength = trimmed.startsWith("0x") ? 7 : 6;
  const suffixLength = 4;
  if (trimmed.length <= prefixLength + suffixLength + 3) return trimmed;
  return `${trimmed.slice(0, prefixLength)}...${trimmed.slice(-suffixLength)}`;
}

export function AtomSuggestionInput({
  id,
  label,
  value,
  lockedAtomId,
  disabled,
  placeholder,
  onChange,
  onLock,
  onUnlock,
  onCreateNew,
  hideCreateNew,
  confidence,
  allowUnlock = true,
}: AtomSuggestionInputProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [searchLimit, setSearchLimit] = useState(PAGE_SIZE);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const query = (value ?? "").trim();
  const canSearch = !lockedAtomId && query.length >= MIN_QUERY_LENGTH && !disabled;

  const rankedSuggestions = useMemo(() => {
    const queryNorm = normalizeSearchText(query);
    if (!queryNorm) return suggestions;

    return suggestions
      .map((suggestion, index) => ({
        suggestion,
        index,
        score: computeSuggestionScore(queryNorm, suggestion),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // Stable tie-breaker: keep original order from API merge.
        return a.index - b.index;
      })
      .map((entry) => entry.suggestion);
  }, [suggestions, query]);

  const visibleSuggestions = useMemo(
    () => rankedSuggestions.slice(0, visibleCount),
    [rankedSuggestions, visibleCount],
  );

  // Check if typed query exactly matches any suggestion label
  const hasExactMatch = useMemo(
    () => suggestions.some((s) => s.label.toLowerCase() === query.toLowerCase()),
    [suggestions, query],
  );

  // Total navigable items: suggestions + optional "create new"
  const showCreateNew = !hideCreateNew && !isLoading && !hasExactMatch && query.length >= MIN_QUERY_LENGTH;
  const totalItems = visibleSuggestions.length + (showCreateNew ? 1 : 0);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setSearchLimit(PAGE_SIZE);
    setSuggestions([]);
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (!canSearch) {
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
      setActiveIndex(-1);
      return;
    }

    const handle = setTimeout(async () => {
      const current = ++requestId.current;
      setIsLoading(true);
      setIsOpen(true);
      try {
        const response = await fetch("/api/intuition/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ query, limit: searchLimit, kind: "atom" }),
        });
        const data = await response.json().catch(() => ({}));

        if (current !== requestId.current) return;

        if (!response.ok) {
          setSuggestions([]);
          setIsOpen(true);
          return;
        }

        const nextSuggestions = parseSuggestions(data?.suggestions);
        setSuggestions(nextSuggestions);
        setIsOpen(true);
      } catch {
        if (current === requestId.current) {
          setSuggestions([]);
          setIsOpen(true);
        }
      } finally {
        if (current === requestId.current) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => clearTimeout(handle);
  }, [canSearch, query, searchLimit]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[role='option']");
    items[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleSelectSuggestion = useCallback(
    (suggestion: Suggestion) => {
      onLock(suggestion.id, suggestion.label);
      setIsOpen(false);
      setActiveIndex(-1);
    },
    [onLock],
  );

  function handleLoadMore() {
    const next = visibleCount + PAGE_SIZE;
    setVisibleCount(next);
    if (next > searchLimit) {
      setSearchLimit(next);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (!isOpen || totalItems === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
        break;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0 && activeIndex < visibleSuggestions.length) {
          handleSelectSuggestion(visibleSuggestions[activeIndex]);
        } else if (activeIndex === visibleSuggestions.length && showCreateNew) {
          // "Create new" option selected — just close the dropdown, keep the typed text
          onCreateNew?.(query);
          setIsOpen(false);
          setActiveIndex(-1);
        }
        break;
      case "Escape":
        event.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        break;
    }
  }

  const listboxId = `${id}-listbox`;

  return (
    <div className={styles.wrapper}>
      <TextInput
        id={id}
        value={value ?? ""}
        disabled={disabled || Boolean(lockedAtomId)}
        placeholder={placeholder}
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={
          isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        role="combobox"
        aria-autocomplete="list"
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setIsOpen(true);
        }}
        onBlur={() => {
          setTimeout(() => {
            setIsOpen(false);
            setActiveIndex(-1);
          }, 150);
        }}
        onKeyDown={handleKeyDown}
      />

      {lockedAtomId && (
        <div className={styles.lockRow}>
          <span className={styles.lockLabel}>
            Locked
            <span className={styles.lockId} title={lockedAtomId}>
              {formatAtomId(lockedAtomId)}
            </span>
            {confidence !== null && confidence !== undefined && confidence < 0.7 && (
              <span className={styles.reviewDot} title="Auto-matched — review recommended" />
            )}
          </span>
          {allowUnlock && (
            <Button size="sm" variant="ghost" onClick={onUnlock}>
              Change
            </Button>
          )}
        </div>
      )}

      {isOpen && !lockedAtomId && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className={styles.suggestions}
        >
          {isLoading && <div className={styles.loading}>Searching Intuition…</div>}
          {!isLoading && visibleSuggestions.length === 0 && !showCreateNew && (
            <div className={styles.empty}>No matching atoms yet.</div>
          )}
          {!isLoading &&
            visibleSuggestions.map((suggestion, index) => (
              <div
                key={`${suggestion.id}-${suggestion.source}`}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.suggestionCard} ${index === activeIndex ? styles.suggestionCardActive : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelectSuggestion(suggestion);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className={styles.cardLabel}>{suggestion.label}</span>
                {(suggestion.marketCap != null ||
                  suggestion.holders != null) && (
                  <div className={styles.cardMetrics}>
                    {suggestion.marketCap != null && (
                      <span className={styles.cardMetric}>
                        <span className={styles.cardMetricLabel}>{labels.metricStaked}</span>
                        <span className={styles.cardMetricValue}>
                          {formatMetric(suggestion.marketCap, 3)}
                        </span>
                      </span>
                    )}
                    {suggestion.holders != null && (
                      <span className={styles.cardMetric}>
                        <span className={styles.cardMetricLabel}>{labels.metricParticipants}</span>
                        <span className={styles.cardMetricValue}>
                          {formatMetric(suggestion.holders, 0)}
                        </span>
                      </span>
                    )}
                  </div>
                )}
                <div className={styles.cardBottom}>
                  <span className={styles.cardSource}>{suggestion.source}</span>
                  <span className={styles.cardId} title={suggestion.id}>
                    {formatAtomId(suggestion.id)}
                  </span>
                </div>
              </div>
            ))}

          {showCreateNew && (
            <div
              id={`${listboxId}-option-${visibleSuggestions.length}`}
              role="option"
              aria-selected={activeIndex === visibleSuggestions.length}
              className={`${styles.createNewOption} ${activeIndex === visibleSuggestions.length ? styles.createNewOptionActive : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                onCreateNew?.(query);
                setIsOpen(false);
                setActiveIndex(-1);
              }}
              onMouseEnter={() => setActiveIndex(visibleSuggestions.length)}
            >
              <span className={styles.createNewIcon}>+</span>
              <span className={styles.createNewText}>
                Create &quot;<strong>{query}</strong>&quot; as new atom
              </span>
            </div>
          )}

          {!isLoading && suggestions.length > visibleCount && (
            <div className={styles.suggestionFooter}>
              <span className={styles.muted}>Showing {visibleCount} results</span>
              <button
                type="button"
                className={styles.loadMore}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleLoadMore();
                }}
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
