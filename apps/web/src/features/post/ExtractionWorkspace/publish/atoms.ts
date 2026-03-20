import { toHex, type Hex } from "viem";
import {
  multiVaultCreateAtoms,
  multiVaultGetAtomCost,
  eventParseAtomCreated,
} from "@0xintuition/protocol";
import { pinThing } from "@0xintuition/sdk";
import { labels } from "@/lib/vocabulary";
import { fetchAtomsByWhere } from "@/lib/intuition/graphql-queries";
import { parseVaultMetrics } from "@/lib/intuition/metrics";
import { escapeLike } from "@/lib/format/escapeLike";
import {
  checkMeaningPreservation,
  scoreCandidate,
  consensusCompare,
  canonicalizeForMatch,
} from "@db/agents";
import type { AtomCandidate, AtomMatch } from "@db/agents/search/types";
import { findExactAtomCandidates, hydrateExactCandidates } from "@/lib/intuition/search";

import type { ApprovedProposalWithRole } from "../extraction";
import type { PublishContext } from "./types";
import { PublishPipelineError, isNonRetryableError } from "./errors";
import { sdkWriteConfig, sdkReadConfig, normalizeText, atomKey, normalizeAtomLabel } from "./config";

/* ── Telemetry types ── */

export type AtomDecisionPath = "locked" | "strict_equivalent" | "graphql_reuse" | "create_new";

export type AtomDecision = {
  label: string;
  termId: string;
  decisionPath: AtomDecisionPath;
  source?: "exact_onchain" | "graphql";
};

const POSITION_THRESHOLDS: Record<AtomMatch["position"], number> = {
  subject: 800,
  predicate: 900,
  object: 750,
};

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

type AtomSlot = {
  label: string;
  key: string;
  lockedId: string | null;
  position: AtomMatch["position"];
};

export function findStrictEquivalent(
  label: string,
  position: AtomMatch["position"],
  candidates: AtomCandidate[],
): { candidate: AtomCandidate; source: "exact_onchain" | "graphql" } | null {
  const group: AtomCandidate[] = [];
  for (const c of candidates) {
    const mp = checkMeaningPreservation(label, c.label, position);
    if (mp === "strict_equivalent") group.push(c);
  }
  if (group.length === 0) return null;
  group.sort(consensusCompare);
  const winner = group[0];
  return {
    candidate: winner,
    source: winner.source === "exact_onchain" ? "exact_onchain" : "graphql",
  };
}

export function findPreserveCandidate(
  label: string,
  position: AtomMatch["position"],
  candidates: AtomCandidate[],
): AtomCandidate | null {
  const threshold = POSITION_THRESHOLDS[position];
  const preserveCandidates: { candidate: AtomCandidate; score: number }[] = [];

  for (const c of candidates) {
    const mp = checkMeaningPreservation(label, c.label, position);
    if (mp === "strict_equivalent") continue; // already handled
    if (mp === "reject" || mp === "ambiguous") continue; // never reused at publish
    // mp === "preserve"
    const score = scoreCandidate(label, c);
    if (score >= threshold) {
      preserveCandidates.push({ candidate: c, score });
    }
  }

  if (preserveCandidates.length === 0) return null;

  // Sort by score desc, then consensus
  preserveCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return consensusCompare(a.candidate, b.candidate);
  });

  return preserveCandidates[0].candidate;
}

export async function resolveAtoms(
  proposals: { proposal: ApprovedProposalWithRole; index: number }[],
  ctx: PublishContext,
  extraAtomLabels: string[] = [],
): Promise<{ atomMap: Map<string, string>; atomTxHash: string | null; atomDecisions: AtomDecision[] }> {
  const atomMap = new Map<string, string>();
  const atomDecisions: AtomDecision[] = [];

  const allSlots: AtomSlot[] = [];
  for (const entry of proposals) {
    const p = entry.proposal;
    allSlots.push(
      { label: normalizeText(p.sText), key: atomKey(p.sText), lockedId: p.subjectAtomId, position: "subject" },
      { label: normalizeText(p.pText), key: atomKey(p.pText), lockedId: p.predicateAtomId, position: "predicate" },
      { label: normalizeText(p.oText), key: atomKey(p.oText), lockedId: p.objectAtomId, position: "object" },
    );
  }

  for (const label of extraAtomLabels) {
    const normalized = normalizeText(label);
    if (normalized) {
      allSlots.push({ label: normalized, key: atomKey(label), lockedId: null, position: "object" });
    }
  }

  // Phase 1: Locked atoms
  for (const slot of allSlots) {
    if (slot.lockedId && !atomMap.has(slot.key)) {
      atomMap.set(slot.key, slot.lockedId);
      atomDecisions.push({ label: slot.label, termId: slot.lockedId, decisionPath: "locked" });
    }
  }

  // Collect unresolved keys (deduplicated)
  const unresolvedKeys = new Set<string>();
  for (const s of allSlots) {
    if (!atomMap.has(s.key)) unresolvedKeys.add(s.key);
  }

  // Phase 2: Exact on-chain + GraphQL with meaning filter
  if (unresolvedKeys.size > 0) {
    const exactLookupConfig = {
      publicClient: ctx.writeConfig.publicClient,
      multivaultAddress: ctx.writeConfig.multivaultAddress,
      normalizeLabel: normalizeAtomLabel,
    };

    try {
      const lookups = await Promise.all(
        Array.from(unresolvedKeys).map(async (key) => {
          const slot = allSlots.find((s) => s.key === key)!;

          // Run exact on-chain + GraphQL in parallel
          const [exactCandidates, graphqlAtoms] = await Promise.all([
            findExactAtomCandidates(slot.label, exactLookupConfig).catch(() => [] as AtomCandidate[]),
            fetchAtomsByWhere(
              { label: { _ilike: `%${escapeLike(slot.label)}%` } }, 20,
            ).catch(() => []),
          ]);

          // Convert GraphQL atoms to candidates
          const graphqlCandidates: AtomCandidate[] = graphqlAtoms
            .map((a): AtomCandidate | null => {
              const termId = a.term_id;
              const label = a.label?.trim();
              if (!termId || !label || label.startsWith("0x")) return null;
              const m = parseVaultMetrics(a.term?.vaults?.[0]);
              return { termId, label, source: "graphql" as const, ...m };
            })
            .filter((c): c is AtomCandidate => c !== null);

          // Hydrate exact candidates with GraphQL stats
          const hydratedExact = exactCandidates.length > 0
            ? await hydrateExactCandidates(exactCandidates, graphqlCandidates)
            : [];

          // Merge all candidates (exact first, then GraphQL, dedup by termId)
          const allCandidates = new Map<string, AtomCandidate>();
          for (const c of hydratedExact) allCandidates.set(c.termId, c);
          for (const c of graphqlCandidates) {
            if (!allCandidates.has(c.termId)) allCandidates.set(c.termId, c);
          }

          return { key, slot, candidates: Array.from(allCandidates.values()) };
        }),
      );

      for (const { key, slot, candidates } of lookups) {
        if (atomMap.has(key)) continue;
        if (candidates.length === 0) continue;

        // Step 1: strict_equivalent group → consensus pick
        const strictMatch = findStrictEquivalent(slot.label, slot.position, candidates);
        if (strictMatch) {
          atomMap.set(key, strictMatch.candidate.termId);
          atomDecisions.push({
            label: slot.label,
            termId: strictMatch.candidate.termId,
            decisionPath: "strict_equivalent",
            source: strictMatch.source,
          });
          continue;
        }

        // Step 2: preserve candidates → score + threshold
        const preserveMatch = findPreserveCandidate(slot.label, slot.position, candidates);
        if (preserveMatch) {
          atomMap.set(key, preserveMatch.termId);
          atomDecisions.push({
            label: slot.label,
            termId: preserveMatch.termId,
            decisionPath: "graphql_reuse",
            source: "graphql",
          });
          continue;
        }

        // No match — will be created in Phase 3
      }
    } catch (error) {
      console.error("[publish/atoms] atom resolution failed", {
        unresolvedCount: unresolvedKeys.size,
        unresolvedKeys: Array.from(unresolvedKeys),
        error: asErrorPayload(error),
      });
      throw new PublishPipelineError("atom_resolution_failed", labels.errorAtomCreation);
    }
  }

  // Phase 3: Create missing atoms on-chain
  const missingKeys = Array.from(unresolvedKeys).filter((k) => !atomMap.has(k));

  let atomTxHash: string | null = null;

  if (missingKeys.length > 0) {
    const createLabels = missingKeys.map((k) => {
      const slot = allSlots.find((s) => s.key === k)!;
      return normalizeAtomLabel(slot.label);
    });

    try {
      const atomCost = await multiVaultGetAtomCost(sdkReadConfig(ctx.writeConfig));

      const pinResults = await Promise.all(
        createLabels.map((label) => pinThing({ name: label }))
      );
      const failedIdx = pinResults.findIndex((uri) => !uri);
      if (failedIdx !== -1) {
        throw new PublishPipelineError("atom_creation_failed", labels.errorAtomCreation);
      }
      const atomUris = pinResults.map((uri) => toHex(uri!));
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
          atomDecisions.push({
            label: createLabels[i],
            termId: String(termId),
            decisionPath: "create_new",
          });
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

      // Retry: check if atoms were created despite tx error
      // Apply the same meaning filter — never reuse a wrong atom
      try {
        const retryLookups = await Promise.all(
          missingKeys.map(async (key) => {
            const slot = allSlots.find((s) => s.key === key)!;
            const atoms = await fetchAtomsByWhere(
              { label: { _ilike: `%${escapeLike(slot.label)}%` } }, 20,
            );
            const candidates: AtomCandidate[] = atoms
              .map((a): AtomCandidate | null => {
                const termId = a.term_id;
                const label = a.label?.trim();
                if (!termId || !label || label.startsWith("0x")) return null;
                const m = parseVaultMetrics(a.term?.vaults?.[0]);
                return { termId, label, source: "graphql" as const, ...m };
              })
              .filter((c): c is AtomCandidate => c !== null);

            // Same logic as main path: strict_equivalent → preserve → create
            const strictMatch = findStrictEquivalent(slot.label, slot.position, candidates);
            if (strictMatch) {
              return {
                key, label: slot.label, termId: strictMatch.candidate.termId,
                decisionPath: "strict_equivalent" as const, source: strictMatch.source,
              };
            }

            const preserveMatch = findPreserveCandidate(slot.label, slot.position, candidates);
            if (preserveMatch) {
              return {
                key, label: slot.label, termId: preserveMatch.termId,
                decisionPath: "graphql_reuse" as const, source: "graphql" as const,
              };
            }

            return { key, label: slot.label, termId: null as string | null, decisionPath: null, source: null };
          }),
        );
        for (const entry of retryLookups) {
          if (entry.termId) {
            atomMap.set(entry.key, entry.termId);
            atomDecisions.push({
              label: entry.label,
              termId: entry.termId,
              decisionPath: entry.decisionPath!,
              source: entry.source ?? undefined,
            });
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

  // Final validation
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

  return { atomMap, atomTxHash, atomDecisions };
}
