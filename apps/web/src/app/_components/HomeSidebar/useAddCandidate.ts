"use client";

import { useState, useCallback } from "react";
import { toHex, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { useAccount, useChainId, usePublicClient, useWalletClient, useSwitchChain } from "wagmi";
import {
  getMultiVaultAddressFromChainId,
  findAtomIds,
  findTripleIds,
} from "@0xintuition/sdk";
import {
  multiVaultCreateAtoms,
  multiVaultGetAtomCost,
  multiVaultCreateTriples,
  multiVaultMultiCallIntuitionConfigs,
  eventParseAtomCreated,
  eventParseTripleCreated,
} from "@0xintuition/protocol";

import { intuitionTestnet } from "@/lib/chain";
import { HAS_TAG_ATOM_ID } from "@/lib/intuition/protocolAtoms";
import { parseTxError } from "@/lib/getErrorMessage";
import { useSessionAuth } from "@/features/post/ExtractionWorkspace/hooks/useSessionAuth";
import { sdkWriteConfig, sdkReadConfig } from "@/features/post/ExtractionWorkspace/publish";

type AddCandidateParams = {
  candidateLabel: string;
  existingAtomTermId: string | null;
  predicateTermId: string;
  objectTermId: string;
  categoryLabel: string;
  themeSlug: string;
  themeAtomTermId: string | null;
};

type AddCandidateResult = {
  postId: string;
  tripleTermId: string;
};

function asHexId(id: string): Hex | null {
  if (/^0x[0-9a-fA-F]+$/.test(id)) return id as Hex;
  return null;
}

export function useAddCandidate() {
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  void message;

  const { ensureSession } = useSessionAuth({ setMessage });

  const addCandidate = useCallback(async (params: AddCandidateParams): Promise<AddCandidateResult | null> => {
    const {
      candidateLabel,
      existingAtomTermId,
      predicateTermId,
      objectTermId,
      categoryLabel,
      themeSlug,
      themeAtomTermId,
    } = params;

    setError(null);

    if (!isConnected || !address) {
      setError("Connect your wallet first.");
      return null;
    }
    if (busy) return null;
    setBusy(true);

    try {
      if (chainId !== intuitionTestnet.id) {
        try {
          await switchChainAsync({ chainId: intuitionTestnet.id });
        } catch {
          setError("Please switch to the correct network.");
          return null;
        }
      }

      if (!walletClient || !publicClient) {
        setError("Wallet not available.");
        return null;
      }

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

      let subjectAtomId = existingAtomTermId;

      if (!subjectAtomId) {
        const existing = await findAtomIds([candidateLabel]);
        for (const atom of existing) {
          if (atom.data === candidateLabel && atom.term_id) {
            subjectAtomId = atom.term_id;
            break;
          }
        }

        if (!subjectAtomId) {
          const atomCost = await multiVaultGetAtomCost(sdkReadConfig(writeConfig));
          const atomUri = toHex(candidateLabel);

          const txHash = await multiVaultCreateAtoms(sdkWriteConfig(writeConfig), {
            args: [[atomUri], [atomCost]],
            value: atomCost,
          });

          const events = await eventParseAtomCreated(publicClient, txHash as Hex);
          const termId = events[0]?.args?.termId;
          if (!termId) {
            setError("Atom creation failed.");
            return null;
          }
          subjectAtomId = String(termId);
        }
      }

      const s = asHexId(subjectAtomId);
      const p = asHexId(predicateTermId);
      const o = asHexId(objectTermId);

      if (!s || !p || !o) {
        setError("Invalid atom IDs.");
        return null;
      }

      const existingTriples = await findTripleIds(address, [[subjectAtomId, predicateTermId, objectTermId]]);
      let tripleTermId = existingTriples.find((r) => r.term_id)?.term_id ?? null;

      if (!tripleTermId) {
        const mvConfig = await multiVaultMultiCallIntuitionConfigs(sdkReadConfig(writeConfig));
        const tripleCost = BigInt(mvConfig.triple_cost);
        const minDeposit = BigInt(mvConfig.min_deposit);

        const txHash = await multiVaultCreateTriples(sdkWriteConfig(writeConfig), {
          args: [[s], [p], [o], [tripleCost + minDeposit]],
          value: tripleCost + minDeposit,
        });

        const events = await eventParseTripleCreated(publicClient, txHash as Hex);
        const termId = events[0]?.args?.termId;
        if (!termId) {
          setError("Triple creation failed.");
          return null;
        }
        tripleTermId = String(termId);
      }

      if (themeAtomTermId) {
        const tagS = asHexId(tripleTermId);
        const tagP = asHexId(HAS_TAG_ATOM_ID);
        const tagO = asHexId(themeAtomTermId);

        if (tagS && tagP && tagO) {
          const existingTag = await findTripleIds(address, [[tripleTermId, HAS_TAG_ATOM_ID, themeAtomTermId]]);
          const tagExists = existingTag.some((r) => r.term_id);

          if (!tagExists) {
            const mvConfig = await multiVaultMultiCallIntuitionConfigs(sdkReadConfig(writeConfig));
            const tagCost = BigInt(mvConfig.triple_cost);

            await multiVaultCreateTriples(sdkWriteConfig(writeConfig), {
              args: [[tagS], [tagP], [tagO], [tagCost]],
              value: tagCost,
            });
          }
        }
      }

      const sessionStillOk = await ensureSession();
      if (!sessionStillOk) {
        setError("Session expired. Please try again.");
        return null;
      }

      const res = await fetch("/api/rankings/add-candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: `${candidateLabel} is the best ${categoryLabel}`,
          tripleTermId,
          themeSlug,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to create post.");
        return null;
      }

      const result: { postId: string } = await res.json();
      return { postId: result.postId, tripleTermId };
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed to add candidate.";
      const { short } = parseTxError(raw);
      setError(short);
      return null;
    } finally {
      setBusy(false);
    }
  }, [isConnected, address, chainId, busy, walletClient, publicClient, switchChainAsync, ensureSession]);

  return { busy, error, addCandidate };
}
