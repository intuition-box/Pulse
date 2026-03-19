"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toHex, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { useAccount, useChainId, usePublicClient, useWalletClient, useSwitchChain } from "wagmi";
import { getMultiVaultAddressFromChainId, findAtomIds } from "@0xintuition/sdk";
import {
  multiVaultCreateAtoms,
  multiVaultGetAtomCost,
  eventParseAtomCreated,
} from "@0xintuition/protocol";

import { intuitionTestnet } from "@/lib/chain";
import { parseTxError } from "@/lib/getErrorMessage";
import { useSessionAuth } from "@/features/post/ExtractionWorkspace/hooks/useSessionAuth";
import { sdkWriteConfig, sdkReadConfig } from "@/features/post/ExtractionWorkspace/publish";

// ─── Types ──────────────────────────────────────────────────────────────────

type CreateThemeResult = {
  slug: string;
  name: string;
  atomTermId: string;
};

type UseCreateThemeReturn = {
  isCreating: boolean;
  error: string | null;
  createTheme: (name: string, description?: string, existingAtomTermId?: string | null) => Promise<CreateThemeResult | null>;
};

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useCreateTheme(): UseCreateThemeReturn {
  const router = useRouter();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  void message; // consumed by useSessionAuth

  const { ensureSession } = useSessionAuth({ setMessage: setMessage });

  async function createTheme(name: string, description?: string, existingAtomTermId?: string | null): Promise<CreateThemeResult | null> {
    setError(null);

    if (!isConnected || !address) {
      setError("Connect your wallet first.");
      return null;
    }

    if (isCreating) return null;
    setIsCreating(true);

    try {
      const trimmedName = name.trim();
      let atomTermId: string | null = existingAtomTermId ?? null;

      if (atomTermId) {
        // ── Path A: existing atom selected ──
        // No on-chain TX needed — just ensure session for DB write
        const sessionOk = await ensureSession();
        if (!sessionOk) {
          setError("Authentication required.");
          return null;
        }
      } else {
        // ── Path B: create new atom on-chain ──
        if (!walletClient || !publicClient) {
          setError("Connect your wallet first.");
          return null;
        }

        // Ensure correct chain
        if (chainId !== intuitionTestnet.id) {
          try {
            await switchChainAsync({ chainId: intuitionTestnet.id });
          } catch {
            setError("Please switch to the correct network.");
            return null;
          }
        }

        // Session check before TX
        const sessionOk = await ensureSession();
        if (!sessionOk) {
          setError("Authentication required.");
          return null;
        }

        const multivaultAddress = getMultiVaultAddressFromChainId(intuitionTestnet.id) as Address;
        const writeConfig = {
          walletClient: walletClient as WalletClient,
          publicClient: publicClient as PublicClient,
          multivaultAddress,
        };

        // Check if atom already exists on-chain
        const existingAtoms = await findAtomIds([trimmedName]);
        for (const atom of existingAtoms) {
          if (atom.data === trimmedName && atom.term_id) {
            atomTermId = atom.term_id;
            break;
          }
        }

        // Create atom on-chain if it doesn't exist
        if (!atomTermId) {
          const atomCost = await multiVaultGetAtomCost(sdkReadConfig(writeConfig));
          const atomUri = toHex(trimmedName);

          const txHash = await multiVaultCreateAtoms(sdkWriteConfig(writeConfig), {
            args: [[atomUri], [atomCost]],
            value: atomCost,
          });

          const events = await eventParseAtomCreated(publicClient, txHash as Hex);
          const termId = events[0]?.args?.termId;
          if (!termId) {
            setError("Atom creation failed — no event emitted.");
            return null;
          }
          atomTermId = String(termId);
        }

        // Re-ensure session (may have expired during wallet signing)
        const sessionStillOk = await ensureSession();
        if (!sessionStillOk) {
          setError("Session expired during signing. Please try again.");
          return null;
        }
      }

      // Save theme to DB
      const res = await fetch("/api/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description?.trim() || undefined,
          atomTermId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to create theme.");
        return null;
      }

      const result: CreateThemeResult = await res.json();
      router.refresh();
      return result;
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed to create theme.";
      const { short } = parseTxError(raw);
      setError(short);
      return null;
    } finally {
      setIsCreating(false);
    }
  }

  return { isCreating, error, createTheme };
}
