import { toHex, type Hex } from "viem";
import {
  multiVaultCreateAtoms,
  multiVaultGetAtomCost,
  eventParseAtomCreated,
} from "@0xintuition/protocol";
import { labels } from "@/lib/vocabulary";
import { fetchAtomsByWhere } from "@/lib/intuition/graphql-queries";
import { escapeLike } from "@/lib/format/escapeLike";

import type { ApprovedProposalWithRole } from "../extraction";
import type { PublishContext } from "./types";
import { PublishPipelineError, isNonRetryableError } from "./errors";
import { sdkWriteConfig, sdkReadConfig, normalizeText, atomKey, normalizeAtomLabel } from "./config";

function asErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }
  if (typeof error === "object" && error !== null) {
    return error as Record<string, unknown>;
  }
  return { value: String(error) };
}

export async function resolveAtoms(
  proposals: { proposal: ApprovedProposalWithRole; index: number }[],
  ctx: PublishContext,
  extraAtomLabels: string[] = [],
): Promise<{ atomMap: Map<string, string>; atomTxHash: string | null }> {
  const atomMap = new Map<string, string>();

  type AtomSlot = { label: string; key: string; lockedId: string | null };
  const allSlots: AtomSlot[] = [];
  for (const entry of proposals) {
    const p = entry.proposal;
    allSlots.push(
      { label: normalizeText(p.sText), key: atomKey(p.sText), lockedId: p.subjectAtomId },
      { label: normalizeText(p.pText), key: atomKey(p.pText), lockedId: p.predicateAtomId },
      { label: normalizeText(p.oText), key: atomKey(p.oText), lockedId: p.objectAtomId },
    );
  }

  for (const label of extraAtomLabels) {
    const normalized = normalizeText(label);
    if (normalized) {
      allSlots.push({ label: normalized, key: atomKey(label), lockedId: null });
    }
  }

  for (const slot of allSlots) {
    if (slot.lockedId && !atomMap.has(slot.key)) {
      atomMap.set(slot.key, slot.lockedId);
    }
  }

  const unresolvedKeys = new Set<string>();
  for (const s of allSlots) {
    if (!atomMap.has(s.key)) unresolvedKeys.add(s.key);
  }

  if (unresolvedKeys.size > 0) {
    try {
      const lookups = await Promise.all(
        Array.from(unresolvedKeys).map(async (key) => {
          const slot = allSlots.find((s) => s.key === key)!;
          const atoms = await fetchAtomsByWhere(
            { label: { _ilike: escapeLike(slot.label) } }, 20,
          );
          return { key, atom: atoms[0] ?? null };
        }),
      );
      for (const { key, atom } of lookups) {
        if (atom?.term_id) {
          atomMap.set(key, String(atom.term_id));
        }
      }
    } catch (error) {
      console.error("[publish/atoms] existing atom lookup failed", {
        unresolvedCount: unresolvedKeys.size,
        unresolvedKeys: Array.from(unresolvedKeys),
        error: asErrorPayload(error),
      });
      throw new PublishPipelineError("atom_resolution_failed", labels.errorAtomCreation);
    }
  }

  const missingKeys = Array.from(unresolvedKeys).filter((k) => !atomMap.has(k));

  let atomTxHash: string | null = null;

  if (missingKeys.length > 0) {
    const createLabels = missingKeys.map((k) => {
      const slot = allSlots.find((s) => s.key === k)!;
      return normalizeAtomLabel(slot.label);
    });

    try {
      const atomCost = await multiVaultGetAtomCost(sdkReadConfig(ctx.writeConfig));
      const atomUris = createLabels.map((label) => toHex(label));
      const costs = Array(createLabels.length).fill(atomCost) as bigint[];
      const totalCost = atomCost * BigInt(createLabels.length);

      atomTxHash = await multiVaultCreateAtoms(sdkWriteConfig(ctx.writeConfig), {
        args: [atomUris, costs],
        value: totalCost,
      });

      const events = await eventParseAtomCreated(ctx.writeConfig.publicClient, atomTxHash as Hex);
      for (let i = 0; i < missingKeys.length; i++) {
        const termId = events[i]?.args?.termId;
        if (termId) {
          atomMap.set(missingKeys[i], String(termId));
        }
      }
    } catch (error) {
      console.error("[publish/atoms] atom creation transaction failed", {
        missingCount: missingKeys.length,
        missingKeys,
        labels: createLabels,
        error: asErrorPayload(error),
      });
      if (error instanceof PublishPipelineError) throw error;
      if (isNonRetryableError(error)) {
        throw new PublishPipelineError("atom_creation_failed", labels.errorAtomCreation);
      }

      try {
        const retryLookups = await Promise.all(
          missingKeys.map(async (key) => {
            const slot = allSlots.find((s) => s.key === key)!;
            const atoms = await fetchAtomsByWhere(
              { label: { _ilike: escapeLike(slot.label) } }, 20,
            );
            return { key, atom: atoms[0] ?? null };
          }),
        );
        for (const { key, atom } of retryLookups) {
          if (atom?.term_id) {
            atomMap.set(key, String(atom.term_id));
          }
        }
        if (missingKeys.some((k) => !atomMap.has(k))) {
          throw new PublishPipelineError("atom_creation_failed", labels.errorAtomCreation);
        }
      } catch (retryErr) {
        console.error("[publish/atoms] atom creation retry verification failed", {
          missingCount: missingKeys.length,
          missingKeys,
          error: asErrorPayload(retryErr),
        });
        if (retryErr instanceof PublishPipelineError) throw retryErr;
        throw new PublishPipelineError("atom_creation_failed", labels.errorAtomCreation);
      }
    }
  }

  const unresolvedSlots = allSlots.filter((slot) => !atomMap.has(slot.key));
  if (unresolvedSlots.length > 0) {
    console.error("[publish/atoms] unresolved atoms after resolution", {
      unresolvedCount: unresolvedSlots.length,
      unresolved: unresolvedSlots.map((s) => ({ key: s.key, label: s.label, lockedId: s.lockedId })),
      resolvedCount: atomMap.size,
    });
  }
  for (const slot of allSlots) {
    if (!atomMap.has(slot.key)) {
      throw new PublishPipelineError("atom_resolution_failed", labels.errorAtomCreation);
    }
  }

  return { atomMap, atomTxHash };
}
