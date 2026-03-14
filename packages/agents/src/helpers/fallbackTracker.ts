

const hits: Record<string, number> = {};

export function trackFallback(name: string): void {
  hits[name] = (hits[name] ?? 0) + 1;
}

export function getFallbackSummary(): Record<string, number> {
  return { ...hits };
}

export function resetFallbackTracking(): void {
  for (const k of Object.keys(hits)) delete hits[k];
}
