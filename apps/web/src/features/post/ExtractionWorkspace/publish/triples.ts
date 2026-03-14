import type { Hex } from "viem";
import { findTripleIds, getTripleDetails } from "@0xintuition/sdk";
import {
  multiVaultMultiCallIntuitionConfigs,
  multiVaultCreateTriples,
  eventParseTripleCreated,
} from "@0xintuition/protocol";
import { labels } from "@/lib/vocabulary";

import {
  asHexId,
  type ApprovedProposalWithRole,
  type DerivedTripleDraft,
  type ResolvedTriple,
  type TripleRole,
} from "../extraction";
import type { PublishContext } from "./types";
import { PublishPipelineError, isNonRetryableError } from "./errors";
import { sdkWriteConfig, sdkReadConfig, atomKey } from "./config";

export async function hydrateMatchedTriples(
  proposals: ApprovedProposalWithRole[],
  resolvedByIndex: Array<ResolvedTriple | null>,
): Promise<{ proposal: ApprovedProposalWithRole; index: number }[]> {
  const remaining: { proposal: ApprovedProposalWithRole; index: number }[] = [];

  for (const [index, proposal] of proposals.entries()) {
    const matchedTripleId = proposal.matchedIntuitionTripleTermId;
    if (matchedTripleId) {
      try {
        const details = await getTripleDetails(matchedTripleId);
        if (!details) {
          throw new PublishPipelineError("hydrate_failed", labels.errorResolution);
        }
        resolvedByIndex[index] = {
          proposalId: proposal.id,
          role: proposal.role,
          subjectAtomId: details.subject_id,
          predicateAtomId: details.predicate_id,
          objectAtomId: details.object_id,
          tripleTermId: matchedTripleId,
          isExisting: true,
        };
      } catch (error) {
        if (error instanceof PublishPipelineError) throw error;
        throw new PublishPipelineError("hydrate_failed", labels.errorResolution);
      }
    } else {
      remaining.push({ proposal, index });
    }
  }

  return remaining;
}

export async function resolveTriples(
  entries: { proposal: ApprovedProposalWithRole; index: number }[],
  atomMap: Map<string, string>,
  resolvedByIndex: Array<ResolvedTriple | null>,
  ctx: PublishContext,
  directMainProposalIds?: Set<string>,
): Promise<{ tripleTxHash: string | null }> {
  type TripleEntry = {
    proposalId: string;
    role: TripleRole;
    subjectAtomId: string;
    predicateAtomId: string;
    objectAtomId: string;
    index: number;
  };

  const tripleEntries: TripleEntry[] = entries.map(({ proposal, index }) => ({
    index,
    proposalId: proposal.id,
    role: proposal.role,
    subjectAtomId: atomMap.get(atomKey(proposal.sText))!,
    predicateAtomId: atomMap.get(atomKey(proposal.pText))!,
    objectAtomId: atomMap.get(atomKey(proposal.oText))!,
  }));

  let existingTripleResults;
  try {
    const tripleQueries = tripleEntries.map(
      (t) => [t.subjectAtomId, t.predicateAtomId, t.objectAtomId] as [string, string, string],
    );
    existingTripleResults = await findTripleIds(ctx.accountAddress, tripleQueries);
  } catch {
    throw new PublishPipelineError("triple_resolution_failed", labels.errorTripleCreation);
  }

  const tripleIdMap = new Map<string, string>();
  for (const existing of existingTripleResults) {
    if (existing.term_id) {
      const key = `${existing.subject_id}-${existing.predicate_id}-${existing.object_id}`;
      tripleIdMap.set(key, existing.term_id);
    }
  }

  const newTripleEntries: TripleEntry[] = [];

  for (const entry of tripleEntries) {
    const key = `${entry.subjectAtomId}-${entry.predicateAtomId}-${entry.objectAtomId}`;
    const existingId = tripleIdMap.get(key);
    if (existingId) {
      resolvedByIndex[entry.index] = {
        proposalId: entry.proposalId,
        role: entry.role,
        subjectAtomId: entry.subjectAtomId,
        predicateAtomId: entry.predicateAtomId,
        objectAtomId: entry.objectAtomId,
        tripleTermId: existingId,
        isExisting: true,
      };
    } else {
      newTripleEntries.push(entry);
    }
  }

  let tripleTxHash: string | null = null;

  if (newTripleEntries.length > 0) {
    try {
      const subjects = newTripleEntries.map((t) => asHexId(t.subjectAtomId)!);
      const predicates = newTripleEntries.map((t) => asHexId(t.predicateAtomId)!);
      const objects = newTripleEntries.map((t) => asHexId(t.objectAtomId)!);

      if (subjects.some((s) => !s) || predicates.some((p) => !p) || objects.some((o) => !o)) {
        throw new PublishPipelineError("triple_creation_failed", labels.errorTripleCreation);
      }

      const mvConfig = await multiVaultMultiCallIntuitionConfigs(sdkReadConfig(ctx.writeConfig));
      const tripleCostOnly = BigInt(mvConfig.triple_cost);
      const minDep = BigInt(mvConfig.min_deposit);
      const deposits = newTripleEntries.map((e) =>
        directMainProposalIds?.has(e.proposalId) ? tripleCostOnly + minDep : tripleCostOnly,
      );
      const totalValue = deposits.reduce((a, b) => a + b, 0n);

      tripleTxHash = await multiVaultCreateTriples(sdkWriteConfig(ctx.writeConfig), {
        args: [subjects as Hex[], predicates as Hex[], objects as Hex[], deposits],
        value: totalValue,
      });

      const events = await eventParseTripleCreated(ctx.writeConfig.publicClient, tripleTxHash as Hex);
      for (let i = 0; i < newTripleEntries.length; i++) {
        const termId = events[i]?.args?.termId;
        const entry = newTripleEntries[i];
        if (termId) {
          resolvedByIndex[entry.index] = {
            proposalId: entry.proposalId,
            role: entry.role,
            subjectAtomId: entry.subjectAtomId,
            predicateAtomId: entry.predicateAtomId,
            objectAtomId: entry.objectAtomId,
            tripleTermId: String(termId),
            isExisting: false,
          };
        } else {
          throw new PublishPipelineError("triple_creation_failed", labels.errorTripleCreation);
        }
      }
    } catch (error) {
      if (error instanceof PublishPipelineError) throw error;
      if (isNonRetryableError(error)) {
        throw new PublishPipelineError("triple_creation_failed", labels.errorTripleCreation);
      }

      try {
        const retryQueries = newTripleEntries.map(
          (t) => [t.subjectAtomId, t.predicateAtomId, t.objectAtomId] as [string, string, string],
        );
        const retryResults = await findTripleIds(ctx.accountAddress, retryQueries);
        let allFound = true;
        for (let i = 0; i < newTripleEntries.length; i++) {
          const entry = newTripleEntries[i];
          const found = retryResults[i]?.term_id;
          if (found) {
            resolvedByIndex[entry.index] = {
              proposalId: entry.proposalId,
              role: entry.role,
              subjectAtomId: entry.subjectAtomId,
              predicateAtomId: entry.predicateAtomId,
              objectAtomId: entry.objectAtomId,
              tripleTermId: found,
              isExisting: true,
            };
          } else {
            allFound = false;
          }
        }
        if (!allFound) {
          throw new PublishPipelineError("triple_creation_failed", labels.errorTripleCreation);
        }
      } catch (retryErr) {
        if (retryErr instanceof PublishPipelineError) throw retryErr;
        throw new PublishPipelineError("triple_creation_failed", labels.errorTripleCreation);
      }
    }
  }

  return { tripleTxHash };
}

export async function resolveDerivedTriples(params: {
  derivedTriples: DerivedTripleDraft[];
  atomMap: Map<string, string>;
  ctx: PublishContext;
}): Promise<{ resolvedDerived: Map<string, string>; derivedTxHash: string | null }> {
  const { derivedTriples, atomMap, ctx } = params;
  const resolvedDerived = new Map<string, string>();

  if (derivedTriples.length === 0) {
    return { resolvedDerived, derivedTxHash: null };
  }

  type DerivedEntry = {
    stableKey: string;
    subjectAtomId: string;
    predicateAtomId: string;
    objectAtomId: string;
  };

  const entries: DerivedEntry[] = [];
  for (const dt of derivedTriples) {
    const sId = atomMap.get(atomKey(dt.subject));
    const pId = atomMap.get(atomKey(dt.predicate));
    const oId = atomMap.get(atomKey(dt.object));

    if (!sId || !pId || !oId) {
      const missing = [!sId && "subject", !pId && "predicate", !oId && "object"].filter(Boolean).join(", ");
      throw new PublishPipelineError(
        "triple_resolution_failed",
        `${labels.errorTripleCreation} Unable to resolve ${missing} for derived triple "${dt.subject} · ${dt.predicate} · ${dt.object}".`,
      );
    }
    entries.push({ stableKey: dt.stableKey, subjectAtomId: sId, predicateAtomId: pId, objectAtomId: oId });
  }

  let existingResults;
  try {
    const queries = entries.map(
      (e) => [e.subjectAtomId, e.predicateAtomId, e.objectAtomId] as [string, string, string],
    );
    existingResults = await findTripleIds(ctx.accountAddress, queries);
  } catch {
    throw new PublishPipelineError("triple_resolution_failed", labels.errorTripleCreation);
  }

  const tripleIdMap = new Map<string, string>();
  for (const existing of existingResults) {
    if (existing.term_id) {
      tripleIdMap.set(`${existing.subject_id}-${existing.predicate_id}-${existing.object_id}`, existing.term_id);
    }
  }

  const newEntries: DerivedEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.subjectAtomId}-${entry.predicateAtomId}-${entry.objectAtomId}`;
    const existingId = tripleIdMap.get(key);
    if (existingId) {
      resolvedDerived.set(entry.stableKey, existingId);
    } else {
      newEntries.push(entry);
    }
  }

  let derivedTxHash: string | null = null;
  if (newEntries.length > 0) {
    try {
      const subjects = newEntries.map((e) => asHexId(e.subjectAtomId)!);
      const predicates = newEntries.map((e) => asHexId(e.predicateAtomId)!);
      const objects = newEntries.map((e) => asHexId(e.objectAtomId)!);

      if (subjects.some((s) => !s) || predicates.some((p) => !p) || objects.some((o) => !o)) {
        throw new PublishPipelineError("triple_creation_failed", labels.errorTripleCreation);
      }

      const mvConfig = await multiVaultMultiCallIntuitionConfigs(sdkReadConfig(ctx.writeConfig));
      const tripleCostOnly = BigInt(mvConfig.triple_cost);
      const deposits = Array(newEntries.length).fill(tripleCostOnly) as bigint[];
      const totalValue = tripleCostOnly * BigInt(newEntries.length);

      derivedTxHash = await multiVaultCreateTriples(sdkWriteConfig(ctx.writeConfig), {
        args: [subjects as Hex[], predicates as Hex[], objects as Hex[], deposits],
        value: totalValue,
      });

      const events = await eventParseTripleCreated(ctx.writeConfig.publicClient, derivedTxHash as Hex);
      for (let i = 0; i < newEntries.length; i++) {
        const termId = events[i]?.args?.termId;
        if (!termId) {
          throw new PublishPipelineError("triple_creation_failed", labels.errorTripleCreation);
        }
        resolvedDerived.set(newEntries[i].stableKey, String(termId));
      }
    } catch (error) {
      if (error instanceof PublishPipelineError) throw error;
      if (isNonRetryableError(error)) {
        throw new PublishPipelineError("triple_creation_failed", labels.errorTripleCreation);
      }

      try {
        const retryQueries = newEntries.map(
          (e) => [e.subjectAtomId, e.predicateAtomId, e.objectAtomId] as [string, string, string],
        );
        const retryResults = await findTripleIds(ctx.accountAddress, retryQueries);
        let allFound = true;
        for (let i = 0; i < newEntries.length; i++) {
          const found = retryResults[i]?.term_id;
          if (found) {
            resolvedDerived.set(newEntries[i].stableKey, found);
          } else {
            allFound = false;
          }
        }
        if (!allFound) throw new PublishPipelineError("triple_creation_failed", labels.errorTripleCreation);
      } catch (retryErr) {
        if (retryErr instanceof PublishPipelineError) throw retryErr;
        throw new PublishPipelineError("triple_creation_failed", labels.errorTripleCreation);
      }
    }
  }

  return { resolvedDerived, derivedTxHash };
}
