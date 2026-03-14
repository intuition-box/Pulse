"use client";

import { useState, useEffect, useRef } from "react";
import type { VaultMetrics } from "@/lib/intuition/types";

export type TripleVaultMetrics = {
  support: VaultMetrics;
  oppose: VaultMetrics;
};

type State = {
  data: Map<string, TripleVaultMetrics>;
  isLoading: boolean;
  fetchError: string | null;
};

export function useTripleVaultMetrics(tripleTermIds: string[]): State {
  const [state, setState] = useState<State>({
    data: new Map(),
    isLoading: false,
    fetchError: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const cacheKey = [...new Set(tripleTermIds)].sort().join(",");

  useEffect(() => {
    if (!cacheKey) {
      setState({ data: new Map(), isLoading: false, fetchError: null });
      return;
    }

    const ids = cacheKey.split(",");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, isLoading: true, fetchError: null }));

    fetch("/api/intuition/triple-metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripleTermIds: ids }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        const metrics = payload?.metrics ?? {};
        const map = new Map<string, TripleVaultMetrics>();
        for (const [id, m] of Object.entries(metrics)) {
          map.set(id, m as TripleVaultMetrics);
        }
        setState({ data: map, isLoading: false, fetchError: null });
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          fetchError: (err as Error).message || "Network error",
        }));
      });

    return () => {
      controller.abort();
    };
  }, [cacheKey]);

  return state;
}
