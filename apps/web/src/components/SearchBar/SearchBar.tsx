"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Search, Loader2, Filter } from "lucide-react";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { ThemeBadge } from "@/components/ThemeBadge/ThemeBadge";
import styles from "./SearchBar.module.css";

type PostSuggestion = {
  id: string;
  body: string;
  user: {
    displayName: string | null;
    address: string;
  };
  themes: { slug: string; name: string }[];
};

type ThemeOption = { slug: string; name: string };

export function SearchBar() {
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PostSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [themeSlug, setThemeSlug] = useState("");
  const [stance, setStance] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Load themes dynamically
  useEffect(() => {
    fetch("/api/themes")
      .then((res) => res.json())
      .then((data) => setThemes(data.themes ?? []))
      .catch(() => {});
  }, []);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/search/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: query.trim(),
            themeSlug: themeSlug || undefined,
            stance: stance || undefined,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          setSuggestions(data.posts || []);
          setShowDropdown(true);
        }
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setLoading(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [query, themeSlug, stance]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSuggestionClick = () => {
    setShowDropdown(false);
    setQuery("");
  };

  const truncate = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  };

  return (
    <div ref={containerRef} className={styles.container}>
      <div className={styles.searchWrapper}>
        <div className={styles.inputWrapper}>
          <Search className={styles.icon} size={18} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search posts..."
            className={styles.input}
            onFocus={() => {
              if (suggestions.length > 0) setShowDropdown(true);
            }}
          />
          {loading && <Loader2 className={styles.loader} size={16} />}
        </div>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={styles.filterButton}
          title="Filters"
        >
          <Filter size={18} />
        </button>
      </div>

      {/* Filter dropdown */}
      {showFilters && (
        <div className={styles.filters}>
          <select
            value={themeSlug}
            onChange={(e) => setThemeSlug(e.target.value)}
            className={styles.select}
          >
            <option value="">All themes</option>
            {themes.map((t) => (
              <option key={t.slug} value={t.slug}>{t.name}</option>
            ))}
          </select>

          <select
            value={stance}
            onChange={(e) => setStance(e.target.value)}
            className={styles.select}
          >
            <option value="">All stances</option>
            <option value="SUPPORTS">Supports</option>
            <option value="REFUTES">Refutes</option>
          </select>
        </div>
      )}

      {/* Dropdown suggestions */}
      {showDropdown && suggestions.length > 0 && (
        <div className={styles.dropdown}>
          {suggestions.map((post) => (
            <Link
              key={post.id}
              href={`/posts/${post.id}`}
              className={styles.suggestion}
              onClick={handleSuggestionClick}
            >
              <div className={styles.suggestionHeader}>
                <span className={styles.suggestionUser}>
                  {post.user.displayName || `${post.user.address.slice(0, 6)}...`}
                </span>
                {post.themes.map((t) => (
                  <ThemeBadge key={t.slug} slug={t.slug}>{t.name}</ThemeBadge>
                ))}
              </div>
              <div className={styles.suggestionBody}>{truncate(post.body, 80)}</div>
            </Link>
          ))}
        </div>
      )}

      {showDropdown && query.trim().length >= 2 && suggestions.length === 0 && !loading && (
        <div className={styles.dropdown}>
          <EmptyState title={`No posts found for "${query}"`} compact />
        </div>
      )}
    </div>
  );
}
