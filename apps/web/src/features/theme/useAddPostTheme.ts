"use client";

import { useState, useCallback } from "react";
import { type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { useAccount, useChainId, usePublicClient, useWalletClient, useSwitchChain } from "wagmi";
import {
  getMultiVaultAddressFromChainId,
  findTripleIds,
} from "@0xintuition/sdk";
import {
  multiVaultCreateTriples,
  multiVaultMultiCallIntuitionConfigs,
} from "@0xintuition/protocol";

import { intuitionTestnet } from "@/lib/chain";
import { HAS_TAG_ATOM_ID } from "@/lib/intuition/protocolAtoms";
import { parseTxError } from "@/lib/getErrorMessage";
import { useSessionAuth } from "@/features/post/ExtractionWorkspace/hooks/useSessionAuth";
import { sdkWriteConfig, sdkReadConfig } from "@/features/post/ExtractionWorkspace/publish";

type AddPostThemeResult = {
  slug: string;
  name: string;
  tagTxHash: string | null;
};

type AddPostThemeParams = {
  postId: string;
  themeSlug: string;
  themeName: string;
  mainTripleTermId: string | null;
  /** Skip DB resolve — pass the atomTermId directly. */
  atomTermId?: string;
  /** Create the theme in DB after the on-chain TX succeeds. */
  createThemeInDb?: boolean;
};

type UseAddPostThemeReturn = {
  isAdding: boolean;
  error: string | null;
  addThemeToPost: (params: AddPostThemeParams) => Promise<AddPostThemeResult | null>;
};

function asHexId(id: string): Hex | null {
  if (/^0x[0-9a-fA-F]+$/.test(id)) return id as Hex;
  return null;
}

export function useAddPostTheme(): UseAddPostThemeReturn {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  void message;

  const { ensureSession } = useSessionAuth({ setMessage });

  const addThemeToPost = useCallback(async (params: AddPostThemeParams): Promise<AddPostThemeResult | null> => {
    const { postId, themeSlug, themeName, mainTripleTermId, atomTermId: directAtomTermId, createThemeInDb } = params;
    setError(null);

    if (!isConnected || !address) {
      setError("Connect your wallet first.");
      return null;
    }
    if (isAdding) return null;
    setIsAdding(true);

    try {
      if (chainId !== intuitionTestnet.id) {
        try {
          await switchChainAsync({ chainId: intuitionTestnet.id });
        } catch {
          setError("Please switch to the correct network.");
          return null;
        }
      }

      const sessionOk = await ensureSession();
      if (!sessionOk) {
        setError("Authentication required.");
        return null;
      }

      let resolvedAtomTermId = directAtomTermId ?? null;

      if (!resolvedAtomTermId) {
        const resolveRes = await fetch("/api/themes/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slugs: [themeSlug] }),
        });
        if (!resolveRes.ok) {
          setError("Failed to resolve theme.");
          return null;
        }
        const resolveData = await resolveRes.json();
        const themeData = resolveData.themes?.[0];
        if (!themeData?.atomTermId) {
          setError("Theme has no on-chain atom. Create it from the Themes page first.");
          return null;
        }
        resolvedAtomTermId = themeData.atomTermId as string;
      }

      let tagTxHash: string | null = null;

      if (mainTripleTermId && walletClient && publicClient) {
        const s = asHexId(mainTripleTermId);
        const p = asHexId(HAS_TAG_ATOM_ID);
        const o = asHexId(resolvedAtomTermId);

        if (s && p && o) {
          const multivaultAddress = getMultiVaultAddressFromChainId(intuitionTestnet.id) as Address;
          const writeConfig = {
            walletClient: walletClient as WalletClient,
            publicClient: publicClient as PublicClient,
            multivaultAddress,
          };

          const existing = await findTripleIds(
            address,
            [[mainTripleTermId, HAS_TAG_ATOM_ID, resolvedAtomTermId]],
          );
          const alreadyExists = existing.some((r) => r.term_id);

          if (!alreadyExists) {
            const mvConfig = await multiVaultMultiCallIntuitionConfigs(sdkReadConfig(writeConfig));
            const tripleCost = BigInt(mvConfig.triple_cost);

            tagTxHash = await multiVaultCreateTriples(sdkWriteConfig(writeConfig), {
              args: [[s], [p], [o], [tripleCost]],
              value: tripleCost,
            });
          }
        }
      }

      const sessionStillOk = await ensureSession();
      if (!sessionStillOk) {
        setError("Session expired during signing. Please try again.");
        return null;
      }

      let finalSlug = themeSlug;
      if (createThemeInDb) {
        const createRes = await fetch("/api/themes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: themeName, atomTermId: resolvedAtomTermId }),
        });
        if (!createRes.ok) {
          const data = await createRes.json().catch(() => ({}));
          setError(data.error ?? "Failed to create theme.");
          return null;
        }
        const created = await createRes.json();
        finalSlug = created.slug;
      }

      const res = await fetch(`/api/posts/${postId}/themes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeSlug: finalSlug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to add theme.");
        return null;
      }

      return { slug: finalSlug, name: themeName, tagTxHash };
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed to add theme.";
      const { short } = parseTxError(raw);
      setError(short);
      return null;
    } finally {
      setIsAdding(false);
    }
  }, [isConnected, address, chainId, isAdding, walletClient, publicClient, switchChainAsync, ensureSession]);

  return { isAdding, error, addThemeToPost };
}
