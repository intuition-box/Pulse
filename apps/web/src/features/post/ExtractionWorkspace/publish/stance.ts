import type { Hex } from "viem";
import { findTripleIds } from "@0xintuition/sdk";
import {
  multiVaultMultiCallIntuitionConfigs,
  multiVaultCreateTriples,
  eventParseTripleCreated,
} from "@0xintuition/protocol";
import { getStanceAtomId, HAS_TAG_ATOM_ID } from "@/lib/intuition/protocolAtoms";
import { labels } from "@/lib/vocabulary";

import { asHexId, makeStanceId, type ResolvedTriple } from "../extraction";
import type { PublishContext, StanceEntry, TagEntry } from "./types";
import { PublishPipelineError, isNonRetryableError } from "./errors";
import { sdkWriteConfig, sdkReadConfig } from "./config";

export async function resolveStanceTriples(params: {
  entries: StanceEntry[];
  resolvedByIndex: Array<ResolvedTriple | null>;
  ctx: PublishContext;
}): Promise<{ stanceTxHash: string | null }> {
  const { entries, resolvedByIndex, ctx } = params;

  if (entries.length === 0) return { stanceTxHash: null };

  const queries: Array<{ entry: StanceEntry; s: string; p: string; o: string }> = [];
  for (const entry of entries) {
    const stanceAtomId = getStanceAtomId(entry.stance);
    queries.push({
      entry,
      s: entry.mainTripleTermId,
      p: stanceAtomId,
      o: entry.parentMainTripleTermId,
    });
  }

  let stanceTxHash: string | null = null;

  try {
    const existingResults = await findTripleIds(
      ctx.accountAddress,
      queries.map((q) => [q.s, q.p, q.o] as [string, string, string]),
    );

    const existingMap = new Map<string, string>();
    for (const result of existingResults) {
      if (result.term_id) {
        existingMap.set(`${result.subject_id}-${result.predicate_id}-${result.object_id}`, result.term_id);
      }
    }

    const toCreate: typeof queries = [];
    for (const q of queries) {
      const key = `${q.s}-${q.p}-${q.o}`;
      const existingId = existingMap.get(key);
      if (existingId) {
        resolvedByIndex.push({
          proposalId: makeStanceId(q.entry.mainProposalId),
          role: "SUPPORTING",
          subjectAtomId: q.s,
          predicateAtomId: q.p,
          objectAtomId: q.o,
          tripleTermId: existingId,
          isExisting: true,
        });
      } else {
        toCreate.push(q);
      }
    }

    if (toCreate.length > 0) {
      const subjects = toCreate.map((q) => asHexId(q.s)!);
      const predicates = toCreate.map((q) => asHexId(q.p)!);
      const objects = toCreate.map((q) => asHexId(q.o)!);

      if (subjects.some((s) => !s) || predicates.some((p) => !p) || objects.some((o) => !o)) {
        throw new PublishPipelineError("stance_failed", labels.errorStanceCreation);
      }

      const mvConfig = await multiVaultMultiCallIntuitionConfigs(sdkReadConfig(ctx.writeConfig));
      const tripleCostOnly = BigInt(mvConfig.triple_cost);
      const deposits = Array(toCreate.length).fill(tripleCostOnly) as bigint[];
      const totalValue = tripleCostOnly * BigInt(toCreate.length);

      stanceTxHash = await multiVaultCreateTriples(sdkWriteConfig(ctx.writeConfig), {
        args: [subjects as Hex[], predicates as Hex[], objects as Hex[], deposits],
        value: totalValue,
      });

      const events = await eventParseTripleCreated(ctx.writeConfig.publicClient, stanceTxHash as Hex);
      for (let i = 0; i < toCreate.length; i++) {
        const termId = events[i]?.args?.termId;
        if (!termId) throw new PublishPipelineError("stance_failed", labels.errorStanceCreation);
        resolvedByIndex.push({
          proposalId: makeStanceId(toCreate[i].entry.mainProposalId),
          role: "SUPPORTING",
          subjectAtomId: toCreate[i].s,
          predicateAtomId: toCreate[i].p,
          objectAtomId: toCreate[i].o,
          tripleTermId: String(termId),
          isExisting: false,
        });
      }
    }
  } catch (error) {
    if (error instanceof PublishPipelineError) throw error;
    if (isNonRetryableError(error)) {
      throw new PublishPipelineError("stance_failed", labels.errorStanceCreation);
    }

    try {
      const retryQueries = queries.map((q) => [q.s, q.p, q.o] as [string, string, string]);
      const retryResults = await findTripleIds(ctx.accountAddress, retryQueries);
      const retryMap = new Map<string, string>();
      for (const r of retryResults) {
        if (r.term_id) retryMap.set(`${r.subject_id}-${r.predicate_id}-${r.object_id}`, r.term_id);
      }

      for (const q of queries) {
        const key = `${q.s}-${q.p}-${q.o}`;
        const found = retryMap.get(key);
        const alreadyResolved = resolvedByIndex.some(
          (r) => r && r.proposalId === makeStanceId(q.entry.mainProposalId),
        );
        if (found && !alreadyResolved) {
          resolvedByIndex.push({
            proposalId: makeStanceId(q.entry.mainProposalId),
            role: "SUPPORTING",
            subjectAtomId: q.s,
            predicateAtomId: q.p,
            objectAtomId: q.o,
            tripleTermId: found,
            isExisting: true,
          });
        } else if (!found && !alreadyResolved) {
          throw new PublishPipelineError("stance_failed", labels.errorStanceCreation);
        }
      }
    } catch (retryErr) {
      if (retryErr instanceof PublishPipelineError) throw retryErr;
      throw new PublishPipelineError("stance_failed", labels.errorStanceCreation);
    }
  }

  return { stanceTxHash };
}

export async function resolveTagTriples(params: {
  entries: TagEntry[];
  ctx: PublishContext;
}): Promise<{ tagTxHash: string | null }> {
  const { entries, ctx } = params;

  if (entries.length === 0) return { tagTxHash: null };

  const seen = new Set<string>();
  const uniqueEntries: TagEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.mainTripleTermId}-${entry.themeAtomTermId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueEntries.push(entry);
  }

  const queries = uniqueEntries.map((e) => ({
    entry: e,
    s: e.mainTripleTermId,
    p: HAS_TAG_ATOM_ID,
    o: e.themeAtomTermId,
  }));

  let tagTxHash: string | null = null;

  try {
    const existingResults = await findTripleIds(
      ctx.accountAddress,
      queries.map((q) => [q.s, q.p, q.o] as [string, string, string]),
    );

    const existingMap = new Map<string, string>();
    for (const result of existingResults) {
      if (result.term_id) {
        existingMap.set(`${result.subject_id}-${result.predicate_id}-${result.object_id}`, result.term_id);
      }
    }

    const toCreate: typeof queries = [];
    for (const q of queries) {
      const key = `${q.s}-${q.p}-${q.o}`;
      if (!existingMap.has(key)) {
        toCreate.push(q);
      }
    }

    if (toCreate.length > 0) {
      const subjects = toCreate.map((q) => asHexId(q.s)!);
      const predicates = toCreate.map((q) => asHexId(q.p)!);
      const objects = toCreate.map((q) => asHexId(q.o)!);

      if (subjects.some((s) => !s) || predicates.some((p) => !p) || objects.some((o) => !o)) {
        throw new PublishPipelineError("triple_creation_failed", labels.errorTagCreation);
      }

      const mvConfig = await multiVaultMultiCallIntuitionConfigs(sdkReadConfig(ctx.writeConfig));
      const tripleCostOnly = BigInt(mvConfig.triple_cost);
      const deposits = Array(toCreate.length).fill(tripleCostOnly) as bigint[];
      const totalValue = tripleCostOnly * BigInt(toCreate.length);

      tagTxHash = await multiVaultCreateTriples(sdkWriteConfig(ctx.writeConfig), {
        args: [subjects as Hex[], predicates as Hex[], objects as Hex[], deposits],
        value: totalValue,
      });

    }
  } catch (error) {
    if (error instanceof PublishPipelineError) throw error;
    if (isNonRetryableError(error)) {
      throw new PublishPipelineError("triple_creation_failed", labels.errorTagCreation);
    }

    try {
      const retryQueries = queries.map((q) => [q.s, q.p, q.o] as [string, string, string]);
      const retryResults = await findTripleIds(ctx.accountAddress, retryQueries);
      const stillMissing = retryResults.filter((r) => !r.term_id).length;
      if (stillMissing > 0) throw new PublishPipelineError("triple_creation_failed", labels.errorTagCreation);
    } catch (retryErr) {
      if (retryErr instanceof PublishPipelineError) throw retryErr;
      throw new PublishPipelineError("triple_creation_failed", labels.errorTagCreation);
    }
  }

  return { tagTxHash };
}
