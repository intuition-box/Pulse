"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import { normalizeLabelForChain } from "@/lib/format/normalizeLabel";
import { makeTripleKey } from "@/lib/format/makeTripleKey";
import { makeLabelKey } from "@/lib/format/makeLabelKey";
import { fetchJsonWithTimeout, FetchError } from "@/lib/net/fetchWithTimeout";
import { scoreTripleMatch, pickBestTripleMatch, type TripleCandidate } from "./scoreTripleMatch";
import {
  type ApprovedProposalWithRole,
  type ApprovedTripleStatus,
  type ApprovedTripleStatusState,
} from "../extraction";

const TIMEOUT_ATOMS = 12_000;
const TIMEOUT_TRIPLES = 10_000;
const TIMEOUT_LABEL = 8_000;
const TIMEOUT_SEMANTIC = 8_000;
const SEMANTIC_SKIP_THRESHOLD = 5;

const normalizeText = normalizeLabelForChain;

type ApprovedResolutionState = {
  statuses: ApprovedTripleStatus[];
  status: ApprovedTripleStatusState;
  error: string | null;
};

type ApprovedResolutionAction =
  | { type: "RESET" }
  | { type: "CHECKING" }
  | { type: "READY"; statuses: ApprovedTripleStatus[] }
  | { type: "ERROR"; error: string };

const INITIAL_APPROVED: ApprovedResolutionState = {
  statuses: [],
  status: "idle",
  error: null,
};

function approvedResolutionReducer(
  state: ApprovedResolutionState,
  action: ApprovedResolutionAction,
): ApprovedResolutionState {
  switch (action.type) {
    case "RESET":
      return INITIAL_APPROVED;
    case "CHECKING":
      return { ...state, status: "checking", error: null };
    case "READY":
      return { statuses: action.statuses, status: "ready", error: null };
    case "ERROR":
      return { ...state, status: "error", error: action.error };
  }
}

type TripleMatchAtoms = {
  subjectAtomId: string;
  predicateAtomId: string;
  objectAtomId: string;
  sLabel: string;
  pLabel: string;
  oLabel: string;
};

type UseTripleResolutionParams = {
  approvedProposals: ApprovedProposalWithRole[];
  address: `0x${string}` | undefined;
  /** Extra atom labels to resolve (e.g. from nested edges / derived triples). */
  extraAtomLabels?: string[];
  onTripleMatched?: (proposalId: string, tripleTermId: string, atoms?: TripleMatchAtoms) => void;
  onAtomResolved?: (proposalId: string, field: "sText" | "pText" | "oText", termId: string, canonicalLabel: string) => void;
};

type UseTripleResolutionReturn = {
  minDeposit: bigint | null;
  atomCost: bigint | null;
  tripleCost: bigint | null;
  approvedTripleStatuses: ApprovedTripleStatus[];
  approvedTripleStatus: ApprovedTripleStatusState;
  approvedTripleStatusError: string | null;
  semanticSkipped: boolean;
  /** Resolved atom labels → termId (normalized label key). */
  resolvedAtomMap: Map<string, string>;
};

type ResolveAtomsResponse = {
  atoms: Array<{ inputLabel: string; termId: string; canonicalLabel: string }>;
};

type ResolveTriplesResponse = {
  byKey: Record<string, string | null>;
};

type TripleMatchInfoResponse = {
  tripleTermId: string;
  subjectAtomId: string;
  predicateAtomId: string;
  objectAtomId: string;
  sLabel: string;
  pLabel: string;
  oLabel: string;
};

type ResolveTriplesByLabelResponse = {
  byLabelKey: Record<string, TripleMatchInfoResponse | null>;
};

export function useTripleResolution({
  approvedProposals,
  address,
  extraAtomLabels,
  onTripleMatched,
  onAtomResolved,
}: UseTripleResolutionParams): UseTripleResolutionReturn {
  const [minDeposit, setMinDeposit] = useState<bigint | null>(null);
  const [atomCost, setAtomCost] = useState<bigint | null>(null);
  const [tripleCost, setTripleCost] = useState<bigint | null>(null);
  const [approved, dispatchApproved] = useReducer(approvedResolutionReducer, INITIAL_APPROVED);
  const [semanticSkipped, setSemanticSkipped] = useState(false);
  const [resolvedAtomMap, setResolvedAtomMap] = useState<Map<string, string>>(new Map());

  const approvedTripleLookupId = useRef(0);

  const onTripleMatchedRef = useRef(onTripleMatched);
  useEffect(() => {
    onTripleMatchedRef.current = onTripleMatched;
  }, [onTripleMatched]);

  const onAtomResolvedRef = useRef(onAtomResolved);
  useEffect(() => {
    onAtomResolvedRef.current = onAtomResolved;
  }, [onAtomResolved]);

  useEffect(() => {
    let active = true;

    async function loadDeposit() {
      if (approvedProposals.length === 0) {
        if (active) {
          setMinDeposit(null);
          setAtomCost(null);
          setTripleCost(null);
        }
        return;
      }

      try {
        const data = await fetchJsonWithTimeout<{
          minDeposit: string;
          tripleCost: string;
          atomCost: string;
        }>("/api/intuition/config");
        if (active) {
          setMinDeposit(BigInt(data.minDeposit));
          setAtomCost(BigInt(data.atomCost));
          setTripleCost(BigInt(data.tripleCost));
        }
      } catch {
        if (active) {
          setMinDeposit(null);
          setAtomCost(null);
          setTripleCost(null);
        }
      }
    }

    loadDeposit();

    return () => {
      active = false;
    };
  }, [approvedProposals.length]);

  useEffect(() => {
    let active = true;
    const requestId = ++approvedTripleLookupId.current;

    if (approvedProposals.length === 0 || !address) {
      dispatchApproved({ type: "RESET" });
      return () => {
        active = false;
      };
    }

    dispatchApproved({ type: "CHECKING" });
    setSemanticSkipped(false);

    async function checkApprovedTriples() {
      try {
        const labelsByProposal = approvedProposals.map((proposal) => ({
          proposalId: proposal.id,
          sLabel: normalizeText(proposal.sText),
          pLabel: normalizeText(proposal.pText),
          oLabel: normalizeText(proposal.oText),
          subjectAtomId: proposal.subjectAtomId ?? null,
          predicateAtomId: proposal.predicateAtomId ?? null,
          objectAtomId: proposal.objectAtomId ?? null,
          matchedIntuitionTripleTermId: proposal.matchedIntuitionTripleTermId ?? null,
        }));

        const missingLabels = new Set<string>();
        const lockedAtomIds = new Set<string>();
        for (const entry of labelsByProposal) {
          const tripleMatched = !!entry.matchedIntuitionTripleTermId;
          if (!tripleMatched && entry.sLabel && !entry.subjectAtomId) missingLabels.add(entry.sLabel);
          else if (entry.subjectAtomId) lockedAtomIds.add(entry.subjectAtomId);
          if (!tripleMatched && entry.pLabel && !entry.predicateAtomId) missingLabels.add(entry.pLabel);
          else if (entry.predicateAtomId) lockedAtomIds.add(entry.predicateAtomId);
          if (!tripleMatched && entry.oLabel && !entry.objectAtomId) missingLabels.add(entry.oLabel);
          else if (entry.objectAtomId) lockedAtomIds.add(entry.objectAtomId);
        }

        if (extraAtomLabels) {
          for (const label of extraAtomLabels) {
            const normalized = normalizeText(label);
            if (normalized) missingLabels.add(normalized);
          }
        }

        const atomMap = new Map<string, string>();
        const canonicalLabelMap = new Map<string, string>();
        const canonicalByIdMap = new Map<string, string>();

        if (missingLabels.size > 0 || lockedAtomIds.size > 0) {
          const atomData = await fetchJsonWithTimeout<
            ResolveAtomsResponse & { atomsById?: Array<{ termId: string; canonicalLabel: string }> }
          >(
            "/api/intuition/resolve-atoms",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                labels: Array.from(missingLabels),
                atomIds: Array.from(lockedAtomIds),
              }),
            },
            TIMEOUT_ATOMS,
          );

          for (const atom of atomData.atoms) {
            atomMap.set(atom.inputLabel, atom.termId);
            if (atom.canonicalLabel) {
              canonicalLabelMap.set(atom.inputLabel, atom.canonicalLabel);
            }
          }

          for (const a of atomData.atomsById ?? []) {
            if (a.canonicalLabel) canonicalByIdMap.set(a.termId, a.canonicalLabel);
          }

          if (!active || requestId !== approvedTripleLookupId.current) return;

          const FIELD_KEYS = [
            { field: "sText" as const, labelKey: "sLabel" as const, atomIdKey: "subjectAtomId" as const, matchedKey: "subjectMatchedLabel" as const },
            { field: "pText" as const, labelKey: "pLabel" as const, atomIdKey: "predicateAtomId" as const, matchedKey: "predicateMatchedLabel" as const },
            { field: "oText" as const, labelKey: "oLabel" as const, atomIdKey: "objectAtomId" as const, matchedKey: "objectMatchedLabel" as const },
          ];
          for (const entry of labelsByProposal) {
            const tripleMatched = !!entry.matchedIntuitionTripleTermId;
            const proposal = approvedProposals.find((p) => p.id === entry.proposalId);
            if (!proposal) continue;
            for (const fk of FIELD_KEYS) {
              const currentId = proposal[fk.atomIdKey];

              if (currentId) {
                const canonical = canonicalByIdMap.get(currentId);
                if (!canonical) continue;
                const currentLabel = proposal[fk.matchedKey];
                if (currentLabel === canonical) continue; // already correct
                onAtomResolvedRef.current?.(entry.proposalId, fk.field, currentId, canonical);
              } else if (!tripleMatched) {
                const label = entry[fk.labelKey];
                const resolvedId = atomMap.get(label);
                const resolvedLabel = canonicalLabelMap.get(label);
                if (!resolvedId || !resolvedLabel) continue;
                const currentLabel = proposal[fk.matchedKey];
                if (currentId === resolvedId && currentLabel === resolvedLabel) continue;
                onAtomResolvedRef.current?.(entry.proposalId, fk.field, resolvedId, resolvedLabel);
              }
            }
          }
        }

        const tripleEntries: Array<{
          proposalId: string;
          key: string;
          subjectAtomId: string;
          predicateAtomId: string;
          objectAtomId: string;
        }> = [];

        const nextStatuses: ApprovedTripleStatus[] = labelsByProposal.map((entry) => {
          if (entry.matchedIntuitionTripleTermId) {
            return {
              proposalId: entry.proposalId,
              tripleTermId: entry.matchedIntuitionTripleTermId,
              isExisting: true,
            };
          }

          const subjectAtomId = entry.subjectAtomId ?? atomMap.get(entry.sLabel) ?? null;
          const predicateAtomId = entry.predicateAtomId ?? atomMap.get(entry.pLabel) ?? null;
          const objectAtomId = entry.objectAtomId ?? atomMap.get(entry.oLabel) ?? null;

          if (!subjectAtomId || !predicateAtomId || !objectAtomId) {
            return { proposalId: entry.proposalId, tripleTermId: null, isExisting: false };
          }

          const key = makeTripleKey(subjectAtomId, predicateAtomId, objectAtomId);
          tripleEntries.push({
            proposalId: entry.proposalId,
            key,
            subjectAtomId,
            predicateAtomId,
            objectAtomId,
          });

          return { proposalId: entry.proposalId, tripleTermId: null, isExisting: false };
        });

        if (tripleEntries.length > 0) {
          const tripleData = await fetchJsonWithTimeout<ResolveTriplesResponse>(
            "/api/intuition/resolve-triples",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                address,
                combinations: tripleEntries.map((entry) => [
                  entry.subjectAtomId,
                  entry.predicateAtomId,
                  entry.objectAtomId,
                ]),
              }),
            },
            TIMEOUT_TRIPLES,
          );

          for (const entry of tripleEntries) {
            const tripleId = tripleData.byKey[entry.key] ?? null;
            if (tripleId) {
              const status = nextStatuses.find((item) => item.proposalId === entry.proposalId);
              if (status) {
                status.tripleTermId = tripleId;
                status.isExisting = true;
              }
            }
          }
        }

        if (!active || requestId !== approvedTripleLookupId.current) return;

        const unresolvedForLabel = labelsByProposal.filter((entry) => {
          const status = nextStatuses.find((s) => s.proposalId === entry.proposalId);
          return status && !status.isExisting;
        });

        if (unresolvedForLabel.length > 0) {
          try {
            const labelData = await fetchJsonWithTimeout<ResolveTriplesByLabelResponse>(
              "/api/intuition/resolve-triples-by-label",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  labels: unresolvedForLabel.map((e) => ({
                    s: e.sLabel,
                    p: e.pLabel,
                    o: e.oLabel,
                  })),
                }),
              },
              TIMEOUT_LABEL,
            );

            if (!active || requestId !== approvedTripleLookupId.current) return;

            for (const entry of unresolvedForLabel) {
              const key = makeLabelKey(entry.sLabel, entry.pLabel, entry.oLabel);
              const matchInfo = labelData.byLabelKey[key];
              if (matchInfo) {
                const status = nextStatuses.find((s) => s.proposalId === entry.proposalId);
                if (status) {
                  status.tripleTermId = matchInfo.tripleTermId;
                  status.isExisting = true;
                }
                onTripleMatchedRef.current?.(entry.proposalId, matchInfo.tripleTermId, {
                  subjectAtomId: matchInfo.subjectAtomId,
                  predicateAtomId: matchInfo.predicateAtomId,
                  objectAtomId: matchInfo.objectAtomId,
                  sLabel: matchInfo.sLabel,
                  pLabel: matchInfo.pLabel,
                  oLabel: matchInfo.oLabel,
                });
              }
            }
          } catch {
            // Fall through to semantic matching.
          }
        }

        if (!active || requestId !== approvedTripleLookupId.current) return;

        const stillUnresolved = labelsByProposal.filter((entry) => {
          const status = nextStatuses.find((s) => s.proposalId === entry.proposalId);
          return status && !status.isExisting;
        });

        if (stillUnresolved.length > 0) {
          if (stillUnresolved.length > SEMANTIC_SKIP_THRESHOLD) {
            setSemanticSkipped(true);
          } else {
          try {
            for (const entry of stillUnresolved) {
              const query = `${entry.sLabel} ${entry.pLabel} ${entry.oLabel}`;
              const searchData = await fetchJsonWithTimeout<{
                triples: Array<TripleCandidate & {
                  subjectId?: string | null;
                  predicateId?: string | null;
                  objectId?: string | null;
                }>;
              }>("/api/intuition/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query,
                  limit: 15,
                  kind: "triple",
                  sLabel: entry.sLabel,
                  pLabel: entry.pLabel,
                  oLabel: entry.oLabel,
                }),
              }, TIMEOUT_SEMANTIC);

              if (!active || requestId !== approvedTripleLookupId.current) return;

              const results = (searchData.triples ?? []).map((sugg) =>
                scoreTripleMatch(entry.sLabel, entry.pLabel, entry.oLabel, sugg),
              );
              const best = pickBestTripleMatch(results);
              if (best) {
                const status = nextStatuses.find((s) => s.proposalId === entry.proposalId);
                if (status) {
                  status.tripleTermId = best.termId;
                  status.isExisting = true;
                }
                const matched = searchData.triples.find((t) => t.id === best.termId);
                const atoms = matched?.subjectId && matched?.predicateId && matched?.objectId
                  ? {
                      subjectAtomId: matched.subjectId,
                      predicateAtomId: matched.predicateId,
                      objectAtomId: matched.objectId,
                      sLabel: matched.subject,
                      pLabel: matched.predicate,
                      oLabel: matched.object,
                    }
                  : undefined;
                onTripleMatchedRef.current?.(entry.proposalId, best.termId, atoms);
              }
            }
          } catch {
            // fail open
          }
          }
        }

        if (!active || requestId !== approvedTripleLookupId.current) return;

        const fullAtomMap = new Map<string, string>();
        for (const [label, termId] of atomMap) fullAtomMap.set(label, termId);
        for (const entry of labelsByProposal) {
          if (entry.subjectAtomId && entry.sLabel) fullAtomMap.set(entry.sLabel, entry.subjectAtomId);
          if (entry.predicateAtomId && entry.pLabel) fullAtomMap.set(entry.pLabel, entry.predicateAtomId);
          if (entry.objectAtomId && entry.oLabel) fullAtomMap.set(entry.oLabel, entry.objectAtomId);
        }
        setResolvedAtomMap(fullAtomMap);

        dispatchApproved({ type: "READY", statuses: nextStatuses });
      } catch (error: unknown) {
        if (!active || requestId !== approvedTripleLookupId.current) return;
        const msg =
          error instanceof FetchError && error.code === "TIMEOUT"
            ? "Claim verification took too long. Your claims are still valid — tap Publish to try again."
            : error instanceof Error
              ? error.message
              : "Unable to resolve triple status.";
        dispatchApproved({ type: "ERROR", error: msg });
      }
    }

    void checkApprovedTriples();

    return () => {
      active = false;
    };
  }, [approvedProposals, address, extraAtomLabels]);

  return {
    minDeposit,
    atomCost,
    tripleCost,
    approvedTripleStatuses: approved.statuses,
    approvedTripleStatus: approved.status,
    approvedTripleStatusError: approved.error,
    semanticSkipped,
    resolvedAtomMap,
  };
}
