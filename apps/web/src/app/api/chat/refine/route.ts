import { requireSiweAuth } from "@/server/auth/siwe";
import { isRecord } from "@/lib/isRecord";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { validateSemanticGuardText } from "./validate";
import { validateAtomRelevance, validateTripleRelevance } from "@/lib/validation/semanticRelevance";
import { conceptKey } from "@/lib/format/conceptKey";
import { searchAtomsServer, searchTriplesServer } from "@/lib/intuition/search";
import type { AtomResult, TripleResult, SearchResultsPayload } from "@/lib/intuition/types";
import { NextResponse } from "next/server";
import { getRefineStreamConfig, type RefineProposal } from "@db/agents/refine";
import { getGroqModel } from "@db/agents/providers";
import { streamText } from "ai";
import type { ModelMessage } from "ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  messages: ModelMessage[];
  proposals: RefineProposal[];
  sourceText: string;
  themeTitle?: string;
  parentClaim?: string;
  reasoningSummary?: string;
  draftPosts?: Array<{ body: string }>;
};

function validateBody(body: unknown): body is RequestBody {
  if (!isRecord(body)) return false;
  if (!Array.isArray(body.messages) || body.messages.length === 0) return false;
  if (!Array.isArray(body.proposals)) return false;
  if (typeof body.sourceText !== "string" || !body.sourceText.trim()) return false;
  return true;
}

type SSEEvent =
  | { v: 1; type: "text"; payload: { text: string } }
  | { v: 1; type: "tool-call"; payload: { name: string; args: Record<string, unknown> } }
  | { v: 1; type: "guard-blocked"; payload: { reason: string; toolName: string; toolCallId: string } }
  | { v: 1; type: "search-results"; payload: SearchResultsPayload };

function sseData(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const isHexId = (v: string) => /^0x[0-9a-f]{6,}$/i.test(v);
const VALID_TRIPLE_FIELDS = new Set(["subject", "predicate", "object"]);

function checkRelevance(
  proposed: { subject: string; predicate: string; object: string },
  refText: string,
): string | null {
  if (!proposed.subject.trim() || !proposed.predicate.trim() || !proposed.object.trim()) {
    return "All triple fields (subject, predicate, object) must be non-empty.";
  }
  const sCheck = validateAtomRelevance(proposed.subject, refText, "sText");
  if (!sCheck.valid) return sCheck.reason ?? "Subject is not related to the post text.";
  const oCheck = validateAtomRelevance(proposed.object, refText, "oText");
  if (!oCheck.valid) return oCheck.reason ?? "Object is not related to the post text.";
  const tripleCheck = validateTripleRelevance(proposed, refText);
  if (!tripleCheck.valid) return tripleCheck.reason ?? "Claim is not related to the post text.";
  return null;
}

function guardToolCall(
  name: string,
  args: Record<string, unknown>,
  proposals: RefineProposal[],
  sourceText: string,
  draftPosts?: Array<{ body: string }>,
): string | null {
  if (name === "update_triple") {
    const proposalId = args.proposalId as string;
    const field = args.field as string;
    const value = args.value as string;
    if (isHexId(value)) return "Use human-readable labels, not on-chain IDs.";
    if (!VALID_TRIPLE_FIELDS.has(field)) return "Invalid field for update_triple.";
    if (!value?.trim()) return "update_triple requires a non-empty value.";
    if (proposalId.startsWith("nested:")) return null;
    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal) return `Proposal ${proposalId} not found.`;

    const refText = (proposal.postNumber != null && draftPosts?.[proposal.postNumber - 1]?.body) || sourceText;

    const proposed = {
      subject: field === "subject" ? value : proposal.subject,
      predicate: field === "predicate" ? value : proposal.predicate,
      object: field === "object" ? value : proposal.object,
    };
    const blocked = checkRelevance(proposed, refText);
    if (blocked) return blocked;
  }

  if (name === "add_triple") {
    const s = args.subject as string;
    const p = args.predicate as string;
    const o = args.object as string;
    const postNum = args.postNumber as number | undefined;
    if (isHexId(s) || isHexId(p) || isHexId(o)) return "Use human-readable labels, not on-chain IDs.";
    if (postNum == null) return "add_triple requires a postNumber.";
    if (postNum < 1) return "Invalid post number.";
    if (!draftPosts || postNum > draftPosts.length) return `Post ${postNum} does not exist.`;

    const refText = draftPosts[postNum - 1]?.body || sourceText;
    const blocked = checkRelevance({ subject: s, predicate: p, object: o }, refText);
    if (blocked) return blocked;
  }

  if (name === "link_atom") {
    const proposalId = args.proposalId as string;
    const field = args.field as string;
    const label = args.label as string;
    const scope = args.scope as string | undefined;
    if (scope && scope !== "global" && scope !== "local") return "Invalid scope. Must be 'global' or 'local'.";
    if (!VALID_TRIPLE_FIELDS.has(field)) return "Invalid field for link_atom.";
    if (isHexId(label)) return "Use human-readable labels, not on-chain IDs.";
    if (proposalId.startsWith("nested:")) return "Use update_triple for nested structural refs.";

    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal) return `Proposal ${proposalId} not found.`;

    const refText = (proposal.postNumber != null && draftPosts?.[proposal.postNumber - 1]?.body) || sourceText;

    const proposed = {
      subject: field === "subject" ? label : proposal.subject,
      predicate: field === "predicate" ? label : proposal.predicate,
      object: field === "object" ? label : proposal.object,
    };
    const blocked = checkRelevance(proposed, refText);
    if (blocked) return blocked;
  }

  if (name === "update_post_body") {
    const postNumber = args.postNumber as number;
    const body = (args.body as string)?.trim();
    if (!body) return "Post body cannot be empty.";
    if (body.length < 5) return "Post body is too short.";
    if (postNumber == null || postNumber < 1) return "Invalid post number.";
    if (!draftPosts || postNumber > draftPosts.length) return `Post ${postNumber} does not exist.`;

    const currentBody = draftPosts[postNumber - 1]?.body ?? "";

    const srcResult = validateSemanticGuardText(sourceText, body);
    const bodyResult = currentBody
      ? validateSemanticGuardText(currentBody, body)
      : { allowed: false };
    if (!srcResult.allowed && !bodyResult.allowed) {
      return srcResult.reason ?? "Body text too far from source.";
    }
  }

  return null;
}

function applyAcceptedToolCall(
  name: string,
  args: Record<string, unknown>,
  mutableProposals: RefineProposal[],
  mutableDraftPosts?: Array<{ body: string }>,
) {
  if (name === "update_triple") {
    const proposal = mutableProposals.find((p) => p.id === args.proposalId);
    if (proposal && typeof args.field === "string" && typeof args.value === "string") {
      if (args.field === "subject") proposal.subject = args.value;
      else if (args.field === "predicate") proposal.predicate = args.value;
      else if (args.field === "object") proposal.object = args.value;
    }
  } else if (name === "add_triple") {
    const id = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    mutableProposals.push({
      id,
      subject: args.subject as string,
      predicate: args.predicate as string,
      object: args.object as string,
      role: "supporting",
      postNumber: typeof args.postNumber === "number" ? args.postNumber : undefined,
    });
  } else if (name === "remove_triple") {
    const idx = mutableProposals.findIndex((p) => p.id === args.proposalId);
    if (idx !== -1) mutableProposals.splice(idx, 1);
  } else if (name === "link_atom") {
    const proposal = mutableProposals.find((p) => p.id === args.proposalId);
    if (proposal && typeof args.field === "string" && typeof args.label === "string") {
      const field = args.field as "subject" | "predicate" | "object";
      const label = args.label;
      const scope = (args.scope as string) ?? "global";
      const originalText = proposal[field];
      const key = conceptKey(originalText);

      proposal[field] = label;

      if (scope === "global") {
        for (const p of mutableProposals) {
          if (p.id === proposal.id) continue;
          for (const f of ["subject", "predicate", "object"] as const) {
            if (conceptKey(p[f]) === key) {
              p[f] = label;
            }
          }
        }
      }
    }
  } else if (name === "update_post_body" && mutableDraftPosts) {
    const idx = (args.postNumber as number) - 1;
    if (idx >= 0 && idx < mutableDraftPosts.length) {
      mutableDraftPosts[idx].body = (args.body as string)?.trim() ?? "";
    }
  } else if (name === "split_posts") {
    let postNum = 1;
    for (const p of mutableProposals) {
      p.postNumber = postNum++;
    }
  }
}

export async function POST(request: Request) {

  try {
    await requireSiweAuth(request);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unauthorized.") },
      { status: 401 },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (!validateBody(body)) {
    return NextResponse.json(
      { error: "Invalid request. Required: messages, proposals, sourceText." },
      { status: 400 },
    );
  }

  const { messages, proposals, sourceText, themeTitle, parentClaim, reasoningSummary, draftPosts } = body;

  const mutableProposals: RefineProposal[] = proposals.map((p) => ({ ...p }));
  const mutableDraftPosts = (draftPosts ?? []).map((d) => ({ ...d }));

  try {
    const model = getGroqModel();

    const config = getRefineStreamConfig({
      model,
      messages,
      proposals,
      sourceText,
      themeTitle,
      parentClaim,
      reasoningSummary,
      draftPosts,
      searchAtoms: async (query, limit) => {
        return searchAtomsServer(query, limit);
      },
      searchTriples: async (query, limit) => {
        return searchTriplesServer(query, limit);
      },
    });

    const result = streamText(config);

    const encoder = new TextEncoder();

    const searchToolCalls = new Map<string, { kind: "atoms" | "triples"; query: string; context?: SearchResultsPayload["context"] }>();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const part of result.fullStream) {
            if (part.type === "text-delta") {
              controller.enqueue(
                encoder.encode(sseData({ v: 1, type: "text", payload: { text: part.text } })),
              );
            } else if (part.type === "tool-result") {

              const meta = searchToolCalls.get(part.toolCallId);
              if (meta) {

                const toolOutput = (part as any).result ?? (part as any).output;
                const rawResults = (toolOutput as { results?: unknown[] })?.results;
                if (Array.isArray(rawResults) && rawResults.length > 0) {
                  controller.enqueue(
                    encoder.encode(sseData({
                      v: 1,
                      type: "search-results",
                      payload: {
                        kind: meta.kind,
                        query: meta.query,
                        results: rawResults.slice(0, 3) as AtomResult[] | TripleResult[],
                        context: meta.context,
                      },
                    })),
                  );
                }
                searchToolCalls.delete(part.toolCallId);
              }
            } else if (part.type === "tool-call") {
              const args = part.input as Record<string, unknown>;

              if (part.toolName === "search_atoms" || part.toolName === "search_triples") {
                const kind = part.toolName === "search_atoms" ? "atoms" as const : "triples" as const;
                const query = args.query as string;
                const proposalId = args.proposalId as string | undefined;
                const field = args.field as "subject" | "predicate" | "object" | undefined;
                const context = proposalId && field ? { proposalId, field } : undefined;
                searchToolCalls.set(part.toolCallId, { kind, query, context });
                continue;
              }
              const blocked = guardToolCall(part.toolName, args, mutableProposals, sourceText, mutableDraftPosts);
              if (blocked) {
                controller.enqueue(
                  encoder.encode(sseData({ v: 1, type: "guard-blocked", payload: { reason: blocked, toolName: part.toolName, toolCallId: part.toolCallId } })),
                );
              } else {
                applyAcceptedToolCall(part.toolName, args, mutableProposals, mutableDraftPosts);
                controller.enqueue(
                  encoder.encode(sseData({ v: 1, type: "tool-call", payload: { name: part.toolName, args } })),
                );
              }
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          console.error("[SSE refine] stream error:", err);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[POST /api/chat/refine] error:", error);
    return NextResponse.json(
      { error: "Chat refinement failed." },
      { status: 500 },
    );
  }
}
