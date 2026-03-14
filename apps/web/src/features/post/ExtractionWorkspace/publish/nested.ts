import type { Hex } from "viem";
import { findTripleIds } from "@0xintuition/sdk";
import {
  multiVaultMultiCallIntuitionConfigs,
  multiVaultCreateTriples,
  eventParseTripleCreated,
} from "@0xintuition/protocol";
import { labels } from "@/lib/vocabulary";

import {
  asHexId,
  type NestedProposalDraft,
  type NestedTermRef,
  type ResolvedNestedTriple,
} from "../extraction";
import type { PublishContext } from "./types";
import { PublishPipelineError, isNonRetryableError } from "./errors";
import { sdkWriteConfig, sdkReadConfig, atomKey } from "./config";

export async function resolveNestedTriples(params: {
  nestedProposals: NestedProposalDraft[];
  resolvedTripleMap: Map<string, string>;
  atomMap: Map<string, string>;
  ctx: PublishContext;
  mainNestedIds?: Set<string>;
}): Promise<{ resolvedNested: ResolvedNestedTriple[]; nestedTxHash: string | null }> {
  const { nestedProposals, resolvedTripleMap, atomMap, ctx, mainNestedIds } = params;

  if (nestedProposals.length === 0) {
    return { resolvedNested: [], nestedTxHash: null };
  }

  const MAX_ROUNDS = 10;
  let remaining = [...nestedProposals];
  const all: ResolvedNestedTriple[] = [];
  let lastTxHash: string | null = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    if (remaining.length === 0) break;

    const resolvable: NestedProposalDraft[] = [];
    const deferred: NestedProposalDraft[] = [];

    for (const edge of remaining) {
      const subOk = edge.subject.type === "atom"
        ? atomMap.has(atomKey(edge.subject.label))
        : resolvedTripleMap.has(edge.subject.tripleKey);
      const objOk = edge.object.type === "atom"
        ? atomMap.has(atomKey(edge.object.label))
        : resolvedTripleMap.has(edge.object.tripleKey);
      (subOk && objOk ? resolvable : deferred).push(edge);
    }

    if (resolvable.length === 0) {
      console.error("[publish] nested resolution blocked:", deferred.map((e) => e.stableKey));
      throw new PublishPipelineError(
        "nested_resolution_failed",
        `${labels.errorNestedCreation} ${deferred.length} context link${deferred.length > 1 ? "s" : ""} could not be resolved.`,
      );
    }

    resolvable.sort((a, b) => a.stableKey.localeCompare(b.stableKey));

    const roundResult = await resolveNestedBatch(resolvable, resolvedTripleMap, atomMap, ctx, mainNestedIds);
    all.push(...roundResult.resolved);
    if (roundResult.txHash) lastTxHash = roundResult.txHash;

    for (const r of roundResult.resolved) {
      const edge = nestedProposals.find((e) => e.id === r.nestedProposalId);
      if (edge) resolvedTripleMap.set(edge.stableKey, r.tripleTermId);
    }
    remaining = deferred;
  }

  if (remaining.length > 0) {
    console.error("[publish] nested resolution exceeded max rounds:", remaining.map((e) => e.stableKey));
    throw new PublishPipelineError(
      "nested_resolution_failed",
      `${labels.errorNestedCreation} ${remaining.length} context link${remaining.length > 1 ? "s" : ""} could not be resolved.`,
    );
  }

  return { resolvedNested: all, nestedTxHash: lastTxHash };
}

async function resolveNestedBatch(
  edges: NestedProposalDraft[],
  resolvedTripleMap: Map<string, string>,
  atomMap: Map<string, string>,
  ctx: PublishContext,
  mainNestedIds?: Set<string>,
): Promise<{ resolved: ResolvedNestedTriple[]; txHash: string | null }> {
  type NestedEntry = {
    nestedProposalId: string;
    subjectTermId: string;
    predicateTermId: string;
    objectTermId: string;
  };

  const entries: NestedEntry[] = [];
  for (const edge of edges) {
    const subjectId = resolveNestedRef(edge.subject, atomMap, resolvedTripleMap);
    const predicateId = atomMap.get(atomKey(edge.predicate));
    const objectId = resolveNestedRef(edge.object, atomMap, resolvedTripleMap);

    if (!subjectId || !predicateId || !objectId) {
      const missing = [!subjectId && "subject", !predicateId && "predicate", !objectId && "object"].filter(Boolean).join(", ");
      console.warn(`[publish] Missing nested ref for edge "${edge.predicate}":`, {
        missing, edgeId: edge.id,
        subject: edge.subject, object: edge.object,
        resolvedTripleMapKeys: [...resolvedTripleMap.keys()],
      });
      throw new PublishPipelineError(
        "nested_resolution_failed",
        `${labels.errorNestedCreation} Unable to resolve ${missing} for context link "${edge.predicate}".`,
      );
    }

    entries.push({
      nestedProposalId: edge.id,
      subjectTermId: subjectId,
      predicateTermId: predicateId,
      objectTermId: objectId,
    });
  }

  let existingResults;
  try {
    const queries = entries.map(
      (e) => [e.subjectTermId, e.predicateTermId, e.objectTermId] as [string, string, string],
    );
    existingResults = await findTripleIds(ctx.accountAddress, queries);
  } catch {
    throw new PublishPipelineError("nested_resolution_failed", labels.errorNestedCreation);
  }

  const tripleIdMap = new Map<string, string>();
  for (const existing of existingResults) {
    if (existing.term_id) {
      tripleIdMap.set(`${existing.subject_id}-${existing.predicate_id}-${existing.object_id}`, existing.term_id);
    }
  }

  const resolved: ResolvedNestedTriple[] = [];
  const newEntries: NestedEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.subjectTermId}-${entry.predicateTermId}-${entry.objectTermId}`;
    const existingId = tripleIdMap.get(key);
    if (existingId) {
      resolved.push({ ...entry, tripleTermId: existingId, isExisting: true });
    } else {
      newEntries.push(entry);
    }
  }

  let txHash: string | null = null;
  if (newEntries.length > 0) {
    try {
      const subjects = newEntries.map((e) => asHexId(e.subjectTermId)!);
      const predicates = newEntries.map((e) => asHexId(e.predicateTermId)!);
      const objects = newEntries.map((e) => asHexId(e.objectTermId)!);

      if (subjects.some((s) => !s) || predicates.some((p) => !p) || objects.some((o) => !o)) {
        throw new PublishPipelineError("nested_creation_failed", labels.errorNestedCreation);
      }

      const mvConfig = await multiVaultMultiCallIntuitionConfigs(sdkReadConfig(ctx.writeConfig));
      const tripleCostOnly = BigInt(mvConfig.triple_cost);
      const minDep = BigInt(mvConfig.min_deposit);
      const deposits = newEntries.map((e) =>
        mainNestedIds?.has(e.nestedProposalId) ? tripleCostOnly + minDep : tripleCostOnly,
      );
      const totalValue = deposits.reduce((a, b) => a + b, 0n);

      txHash = await multiVaultCreateTriples(sdkWriteConfig(ctx.writeConfig), {
        args: [subjects as Hex[], predicates as Hex[], objects as Hex[], deposits],
        value: totalValue,
      });

      const events = await eventParseTripleCreated(ctx.writeConfig.publicClient, txHash as Hex);
      for (let i = 0; i < newEntries.length; i++) {
        const termId = events[i]?.args?.termId;
        if (!termId) {
          throw new PublishPipelineError("nested_creation_failed", labels.errorNestedCreation);
        }
        resolved.push({ ...newEntries[i], tripleTermId: String(termId), isExisting: false });
      }
    } catch (error) {
      if (error instanceof PublishPipelineError) throw error;
      if (isNonRetryableError(error)) {
        throw new PublishPipelineError("nested_creation_failed", labels.errorNestedCreation);
      }

      try {
        const retryQueries = newEntries.map(
          (e) => [e.subjectTermId, e.predicateTermId, e.objectTermId] as [string, string, string],
        );
        const retryResults = await findTripleIds(ctx.accountAddress, retryQueries);
        let allFound = true;
        for (let i = 0; i < newEntries.length; i++) {
          const found = retryResults[i]?.term_id;
          if (found) {
            resolved.push({ ...newEntries[i], tripleTermId: found, isExisting: true });
          } else {
            allFound = false;
          }
        }
        if (!allFound) throw new PublishPipelineError("nested_creation_failed", labels.errorNestedCreation);
      } catch (retryErr) {
        if (retryErr instanceof PublishPipelineError) throw retryErr;
        throw new PublishPipelineError("nested_creation_failed", labels.errorNestedCreation);
      }
    }
  }

  return { resolved, txHash };
}

function resolveNestedRef(
  ref: NestedTermRef,
  atomMap: Map<string, string>,
  resolvedTripleMap: Map<string, string>,
): string | undefined {
  if (ref.type === "atom") {
    return atomMap.get(atomKey(ref.label));
  }
  return resolvedTripleMap.get(ref.tripleKey);
}
