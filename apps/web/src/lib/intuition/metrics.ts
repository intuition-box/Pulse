
import { asNumber } from "@/lib/format/asNumber";
import type { VaultMetrics } from "./types";

export type { VaultMetrics };

export function parseVaultMetrics(vault: {
  total_shares?: string | number | null;
  current_share_price?: string | number | null;
  position_count?: string | number | null;
  market_cap?: string | number | null;
} | null | undefined): VaultMetrics {
  if (!vault) return { holders: null, shares: null, marketCap: null, sharePrice: null };
  const rawShares = asNumber(vault.total_shares ?? null);
  const rawPrice = asNumber(vault.current_share_price ?? null);
  const shares = rawShares !== null ? rawShares / 1e18 : null;
  const sharePrice = rawPrice !== null ? rawPrice / 1e18 : null;
  const rawMc = asNumber(vault.market_cap ?? null);
  const marketCap = rawMc !== null ? rawMc / 1e18 : null;
  const holders = asNumber(vault.position_count ?? null);
  return { holders, shares, marketCap, sharePrice };
}
