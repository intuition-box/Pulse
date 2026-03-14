"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import type { DraftPost, ProposalActions, PropagationResult } from "../extraction";
import type { AtomResult, TripleResult, SearchResultsPayload, QuickAction } from "@/lib/intuition/types";
import { validateAtomRelevance, validateTripleRelevance, getReferenceBodyForProposal } from "@/lib/validation/semanticRelevance";
export type { AtomResult, TripleResult, SearchResultsPayload, QuickAction };

export type RefineQuickAction = QuickAction & { action?: string };

export type ToolFeedback = {
  toolName: string;
  description: string;
  success: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;

  searchResults?: SearchResultsPayload;

  quickActions?: RefineQuickAction[];

  toolFeedback?: ToolFeedback[];

  details?: true;
};

type Proposal = {
  id: string;
  sText: string;
  pText: string;
  oText: string;
  role: "MAIN" | "SUPPORTING";

  postNumber?: number;
};

export type UseRefineChatParams = {
  proposals: Proposal[];
  proposalActions: ProposalActions;
  draftPosts: DraftPost[];
  sourceText: string;
  themeTitle?: string;
  parentClaim?: string;
  reasoningSummary?: string;
  onBodyChange?: (draftId: string, body: string) => void;
  onSplit?: () => void;
  onUpdateNestedPredicate?: (nestedId: string, label: string) => void;
  onUpdateNestedAtom?: (nestedId: string, slot: "subject" | "object", label: string) => void;
};

type SSEEvent =
  | { v: 1; type: "text"; payload: { text: string } }
  | { v: 1; type: "tool-call"; payload: { name: string; args: Record<string, unknown> } }
  | { v: 1; type: "guard-blocked"; payload: { reason: string; toolName: string; toolCallId: string } }
  | { v: 1; type: "search-results"; payload: SearchResultsPayload };

const FIELD_MAP = { subject: "sText", predicate: "pText", object: "oText" } as const;
const isHexId = (v: string) => /^0x[0-9a-f]{6,}$/i.test(v);

function sanitizeHexIds(text: string): string {
  return text.replace(/\b0x[0-9a-fA-F]{6,}\b/g, "[...]");
}

function describeToolAction(name: string, args?: Record<string, unknown>): string {
  switch (name) {
    case "update_triple": {
      const field = args?.field as string | undefined;
      const value = args?.value as string | undefined;
      if (field && value) return `Updated ${field} to "${value}"`;
      return "Updated claim field.";
    }
    case "add_triple": {
      const s = args?.subject as string | undefined;
      const p = args?.predicate as string | undefined;
      const o = args?.object as string | undefined;
      if (s && p && o) return `Added claim: ${s} | ${p} | ${o}`;
      return "Added a new claim.";
    }
    case "remove_triple": return "Removed a claim.";
    case "link_atom": {
      const field = args?.field as string | undefined;
      const label = args?.label as string | undefined;
      if (field && label) return `Linked ${field} to "${label}"`;
      return "Linked existing atom.";
    }
    case "update_post_body": {
      const postNumber = args?.postNumber as number | undefined;
      if (postNumber) return `Updated body of post ${postNumber}`;
      return "Updated post body.";
    }
    case "split_posts": return "Split claims into separate posts.";
    default: return "Applied change.";
  }
}

type ApplyResult = { blocked: string | null; propagation?: PropagationResult };

function applyToolCall(
  name: string,
  args: Record<string, unknown>,
  actions: ProposalActions,
  proposals: Proposal[],
  draftPosts: DraftPost[],
  parentClaim: string | undefined,
  onBodyChange?: (draftId: string, body: string) => void,
  onSplit?: () => void,
  onUpdateNestedPredicate?: (nestedId: string, label: string) => void,
  onUpdateNestedAtom?: (nestedId: string, slot: "subject" | "object", label: string) => void,
): ApplyResult {
  if (name === "update_triple") {
    const proposalId = args.proposalId as string;
    const field = args.field as keyof typeof FIELD_MAP;
    const value = args.value as string;
    if (!proposalId || !field || !value || !FIELD_MAP[field]) {
      return { blocked: "update_triple requires proposalId, field, and value." };
    }

    if (proposalId.startsWith("nested:")) {
      const nestedId = proposalId.slice(7);
      if (field === "predicate") {
        if (!onUpdateNestedPredicate) return { blocked: "Nested predicate editing not available." };
        onUpdateNestedPredicate(nestedId, value);
      } else {
        const slot = field === "subject" ? "subject" as const : "object" as const;
        if (!onUpdateNestedAtom) return { blocked: "Nested atom editing not available." };
        onUpdateNestedAtom(nestedId, slot, value);
      }
      return { blocked: null };
    }

    const target = proposals.find((p) => p.id === proposalId);
    if (!target) return { blocked: `Proposal ${proposalId} not found.` };

    const body = getReferenceBodyForProposal(proposalId, draftPosts);
    if (body) {
      const updated = {
        subject: field === "subject" ? value : target.sText,
        predicate: field === "predicate" ? value : target.pText,
        object: field === "object" ? value : target.oText,
      };
      const check = validateTripleRelevance(updated, body, { contextText: parentClaim });
      if (!check.valid) return { blocked: check.reason ?? "Updated claim is not related to the post text." };
    }
    actions.onChange(proposalId, FIELD_MAP[field], value);
  } else if (name === "link_atom") {
    const proposalId = args.proposalId as string;
    const field = args.field as keyof typeof FIELD_MAP;
    const atomId = args.atomId as string;
    const label = args.label as string;
    const scope = (args.scope as string) ?? "global";
    if (!proposalId || !field || !atomId || !label || !FIELD_MAP[field]) {
      return { blocked: "link_atom requires proposalId, field, atomId, and label." };
    }
    const target = proposals.find((p) => p.id === proposalId);
    if (!target) return { blocked: `Proposal ${proposalId} not found.` };

    const body = getReferenceBodyForProposal(proposalId, draftPosts);
    if (body) {
      const check = validateAtomRelevance(label, body, FIELD_MAP[field], { contextText: parentClaim });
      if (!check.valid) return { blocked: check.reason ?? "Atom is not related to the post text." };
    }
    actions.onLock(proposalId, FIELD_MAP[field], atomId, label);

    if (scope === "global") {
      const sourceText = target[FIELD_MAP[field]] ?? label;
      const result = actions.onPropagateAtom(sourceText, atomId, label);
      return { blocked: null, propagation: result };
    }
  } else if (name === "remove_triple") {
    const proposalId = args.proposalId as string;
    if (proposalId) actions.onReject(proposalId);
  } else if (name === "add_triple") {
    const s = (args.subject as string)?.trim();
    const p = (args.predicate as string)?.trim();
    const o = (args.object as string)?.trim();
    if (!s || !p || !o) return { blocked: "add_triple requires non-empty subject, predicate, and object." };
    if (isHexId(s) || isHexId(p) || isHexId(o)) return { blocked: "Use human-readable labels, not on-chain IDs." };
    const postNum = typeof args.postNumber === "number" ? args.postNumber : undefined;
    if (postNum == null) return { blocked: "add_triple requires postNumber." };
    const targetDraft = draftPosts.find((_, i) => i + 1 === postNum);
    if (!targetDraft) return { blocked: `Post ${postNum} not found.` };

    if (targetDraft.body) {
      const check = validateTripleRelevance(
        { subject: s, predicate: p, object: o },
        targetDraft.body,
        { contextText: parentClaim },
      );
      if (!check.valid) return { blocked: check.reason ?? "New claim is not related to the post text." };
    }
    actions.onAddTriple(s, p, o, targetDraft.id);
  } else if (name === "update_post_body") {
    const postNumber = args.postNumber as number;
    const body = (args.body as string)?.trim();
    if (!body) return { blocked: "Post body cannot be empty." };
    if (postNumber == null || postNumber < 1) return { blocked: "Invalid post number." };
    const targetDraft = draftPosts[postNumber - 1];
    if (!targetDraft) return { blocked: `Post ${postNumber} not found.` };
    onBodyChange?.(targetDraft.id, body);
  } else if (name === "split_posts") {
    if (!onSplit) return { blocked: "Split not available." };
    onSplit();
  }
  return { blocked: null };
}

async function fetchAtomResults(query: string, signal?: AbortSignal): Promise<AtomResult[]> {
  const res = await fetch("/api/intuition/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 5, kind: "atom" }),
    signal,
  });
  if (!res.ok) return [];
  const data = await res.json();
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
  return suggestions.map((s: { id: string; label: string; holders?: number | null; shares?: number | null; marketCap?: number | null; sharePrice?: number | null; tripleCount?: number | null }) => ({
    termId: s.id,
    label: s.label,
    holders: s.holders ?? null,
    shares: s.shares ?? null,
    marketCap: s.marketCap ?? null,
    sharePrice: s.sharePrice ?? null,
    tripleCount: s.tripleCount ?? null,
  }));
}

export function useRefineChat({
  proposals,
  proposalActions,
  draftPosts,
  sourceText,
  themeTitle,
  parentClaim,
  reasoningSummary,
  onBodyChange,
  onSplit,
  onUpdateNestedPredicate,
  onUpdateNestedAtom,
}: UseRefineChatParams) {
  const initialMsg = useMemo<ChatMessage[]>(() => [
    {
      id: "guided-actions",
      role: "assistant" as const,
      content: "",
      quickActions: [
        { label: "See details", message: "", action: "open_details" },
      ],
    },
  ], []);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMsg);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleAction = useCallback(
    (action: string) => {
      if (action === "open_details") {

        setMessages((prev) => {
          const withoutOldDetails = prev.filter((m) => !m.details);
          return [
            ...withoutOldDetails,
            { id: `details-${Date.now()}`, role: "assistant" as const, content: "", details: true },
          ];
        });
      }
    },
    [],
  );

  const sendMessage = useCallback(
    async (userText: string) => {
      if (!userText.trim() || isStreaming) return;

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: userText.trim(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setError(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const draftProposals = proposals.map((p) => ({
          id: p.id,
          subject: p.sText,
          predicate: p.pText,
          object: p.oText,
          role: p.role === "MAIN" ? "primary" as const : "supporting" as const,
          ...(p.postNumber != null ? { postNumber: p.postNumber } : {}),
        }));

        const apiMessages = [...messages, userMsg]
          .filter((m) => !m.searchResults && !m.quickActions)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        const res = await fetch("/api/chat/refine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
            proposals: draftProposals,
            sourceText,
            themeTitle,
            parentClaim,
            reasoningSummary,
            draftPosts: draftPosts.map((d) => ({ body: d.body })),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let assistantText = "";
        const assistantId = `assistant-${Date.now()}`;
        let buffer = "";
        const appliedTools: Array<{ name: string; args: Record<string, unknown> }> = [];
        const toolFeedbacks: ToolFeedback[] = [];

        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: "" },
        ]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) {

            buffer += decoder.decode(undefined, { stream: false });
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");

          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            let event: SSEEvent;
            try {
              event = JSON.parse(data) as SSEEvent;
            } catch {
              continue;
            }

            if (event.v !== 1) continue;

            if (event.type === "text") {
              assistantText += sanitizeHexIds(event.payload.text);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: assistantText } : m,
                ),
              );
            } else if (event.type === "tool-call") {
              const { blocked, propagation } = applyToolCall(
                event.payload.name,
                event.payload.args,
                proposalActions,
                proposals,
                draftPosts,
                parentClaim,
                onBodyChange,
                onSplit,
                onUpdateNestedPredicate,
                onUpdateNestedAtom,
              );
              if (!blocked) {
                appliedTools.push({ name: event.payload.name, args: event.payload.args });
                toolFeedbacks.push({ toolName: event.payload.name, description: describeToolAction(event.payload.name, event.payload.args), success: true });

                if (propagation && propagation.updatedClaims > 0) {
                  const label = event.payload.args.label as string;
                  assistantText += `\nLinked "${label}" — updated in ${propagation.updatedPosts} post(s) / ${propagation.updatedClaims} claim(s).`;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, content: assistantText } : m,
                    ),
                  );
                }
              }
              if (blocked) {
                toolFeedbacks.push({ toolName: event.payload.name, description: blocked, success: false });
                assistantText += `\n⚠️ ${blocked}`;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: assistantText } : m,
                  ),
                );
              }
            } else if (event.type === "search-results") {

              const searchMsgId = `search-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
              setMessages((prev) => [
                ...prev,
                { id: searchMsgId, role: "assistant", content: "", searchResults: event.payload },
              ]);
            } else if (event.type === "guard-blocked") {

              if (assistantText.trim()) {
                assistantText = `⚠️ Change not applied (${event.payload.toolName}): ${event.payload.reason}`;
              } else {
                assistantText = `⚠️ ${event.payload.reason}`;
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: assistantText } : m,
                ),
              );
            }
          }
        }

        if (buffer.trim()) {
          const remaining = buffer.trim();
          if (remaining.startsWith("data: ") && remaining.slice(6) !== "[DONE]") {
            try {
              const event = JSON.parse(remaining.slice(6)) as SSEEvent;
              if (event.type === "text") assistantText += sanitizeHexIds(event.payload.text);
            } catch {
              // Ignore malformed trailing SSE payloads.
            }
          }
        }

        if (!assistantText.trim() && appliedTools.length > 0) {
          assistantText = appliedTools.map((t) => describeToolAction(t.name, t.args)).join("\n");
        }

        if (!assistantText.trim() && appliedTools.length === 0 && toolFeedbacks.length === 0) {
          assistantText = "I couldn't process that request. Could you rephrase?";
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: assistantText, ...(toolFeedbacks.length > 0 ? { toolFeedback: toolFeedbacks } : {}) }
              : m,
          ),
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Chat error";
        setError(msg);
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, proposals, proposalActions, draftPosts, sourceText, themeTitle, parentClaim, reasoningSummary, onBodyChange, onSplit, onUpdateNestedPredicate, onUpdateNestedAtom, isStreaming],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const clearChat = useCallback(() => {
    setMessages(initialMsg);
    setError(null);
  }, [initialMsg]);

  const searchAtomForEdit = useCallback(
    async (query: string): Promise<AtomResult[]> => {
      if (query.length < 2) return [];
      try {
        return await fetchAtomResults(query);
      } catch {
        return [];
      }
    },
    [],
  );

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    handleAction,
    stopStreaming,
    clearChat,
    searchAtomForEdit,
  };
}
