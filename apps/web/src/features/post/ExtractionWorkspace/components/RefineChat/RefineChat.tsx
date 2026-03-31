"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage, SearchResultsPayload, AtomResult, TripleResult, RefineQuickAction } from "../../hooks/useRefineChat";

import type { ApprovedProposalWithRole, DerivedTripleDraft, DraftPost, NestedProposalDraft, ApprovedTripleStatus } from "../../extraction";
import { DetailsMessage } from "./DetailsMessage";
import type { TripleVaultMetrics } from "./useTripleVaultMetrics";
import styles from "./RefineChat.module.css";

function isAtomResult(r: AtomResult | TripleResult): r is AtomResult {
  return "label" in r && !("subject" in r);
}

function SearchResultsMessage({
  searchResults,
  onPropagateAtom,
  getSlotText,
}: {
  searchResults: SearchResultsPayload;
  onPropagateAtom?: (sourceSlotText: string, atomId: string, label: string) => void;
  getSlotText?: (proposalId: string, field: "subject" | "predicate" | "object") => string | null;
}) {
  const ctx = searchResults.context;
  const hasContext = !!(ctx?.proposalId && ctx?.field);
  const sourceSlotText = hasContext && getSlotText ? getSlotText(ctx!.proposalId, ctx!.field) : null;

  const isClickable = searchResults.kind === "atoms" && hasContext && !!sourceSlotText && !!onPropagateAtom;

  const count = searchResults.results.length;
  const kindLabel = searchResults.kind === "atoms" ? "match" : "claim";
  const countLabel = `${count} ${kindLabel}${count !== 1 ? (searchResults.kind === "atoms" ? "es" : "s") : ""}`;

  return (
    <div className={styles.searchResultsMsg}>
      <p className={styles.searchHeader}>
        &ldquo;{searchResults.query}&rdquo; &mdash; {countLabel}
      </p>
      {searchResults.results.map((r) => {
        if (isAtomResult(r)) {
          return (
            <div
              key={r.termId}
              className={isClickable ? styles.searchRowClickable : styles.searchRow}
              role={isClickable ? "button" : undefined}
              tabIndex={isClickable ? 0 : undefined}
              aria-disabled={!isClickable || undefined}
              onClick={isClickable ? () => onPropagateAtom!(sourceSlotText!, r.termId, r.label) : undefined}
              onKeyDown={isClickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPropagateAtom!(sourceSlotText!, r.termId, r.label); } } : undefined}
            >
              <span className={styles.searchLabel}>{r.label}</span>
              <span className={styles.searchMetrics}>
                {r.holders ?? 0}p &middot; {(r.marketCap ?? 0).toFixed(1)} MC
              </span>
            </div>
          );
        }

        const tr = r as TripleResult;
        return (
          <div key={tr.termId} className={styles.searchRow} aria-disabled="true">
            <span className={styles.searchLabel}>
              {tr.subject} | {tr.predicate} | {tr.object}
            </span>
            {(tr.marketCap != null || tr.holders != null) && (
              <span className={styles.searchMetrics}>
                {tr.holders ?? 0}p &middot; {(tr.marketCap ?? 0).toFixed(1)} MC
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuickActionsMessage({
  actions,
  onSend,
  onAction,
  disabled,
}: {
  actions: RefineQuickAction[];
  onSend: (text: string) => void;
  onAction?: (action: string) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.quickActionsMsg}>
      <p className={styles.quickActionsLabel}>What would you like to do?</p>
      <div className={styles.quickActionsRow}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={styles.quickActionChip}
            onClick={() => {
              if (a.action && onAction) onAction(a.action);
              else onSend(a.message);
            }}
            disabled={disabled}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type RefineChatProps = {
  panel?: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onAction?: (action: string) => void;
  onStop: () => void;
  onClear: () => void;
  onPropagateAtom?: (sourceSlotText: string, atomId: string, label: string) => void;
  getSlotText?: (proposalId: string, field: "subject" | "predicate" | "object") => string | null;
  proposals?: ApprovedProposalWithRole[];
  draftPosts?: DraftPost[];
  nestedEdges?: NestedProposalDraft[];
  derivedTriples?: DerivedTripleDraft[];
  approvedTripleStatuses?: ApprovedTripleStatus[];
  tripleVaultMetrics?: Map<string, TripleVaultMetrics>;
  tripleMetricsLoading?: boolean;
  tripleMetricsError?: string | null;
  searchAtomForEdit?: (query: string) => Promise<AtomResult[]>;
  onUpdateNestedPredicate?: (nestedId: string, label: string) => void;
  onUpdateNestedAtom?: (nestedId: string, slot: "subject" | "object", label: string) => void;
  onUpdateDerivedTriple?: (stableKey: string, field: "subject" | "predicate" | "object", value: string) => void;
  onSetNewTermLocal?: (proposalId: string, field: "sText" | "pText" | "oText", label: string) => void;
  resolvedAtomMap?: Map<string, string>;
  nestedTripleStatuses?: Map<string, string>;
  derivedCanonicalLabels?: Map<string, { s?: string; p?: string; o?: string }>;
};

export function RefineChat({
  panel,
  messages,
  isStreaming,
  error,
  onSend,
  onAction,
  onStop,
  onClear,
  onPropagateAtom,
  getSlotText,
  proposals,
  draftPosts,
  nestedEdges,
  derivedTriples,
  approvedTripleStatuses,
  tripleVaultMetrics,
  tripleMetricsLoading,
  tripleMetricsError,
  searchAtomForEdit,
  onUpdateNestedPredicate,
  onUpdateNestedAtom,
  onUpdateDerivedTriple,
  onSetNewTermLocal,
  resolvedAtomMap,
  nestedTripleStatuses,
  derivedCanonicalLabels,
}: RefineChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    onSend(input);
    setInput("");
  };

  const hasRealMessages = messages.some((m) => !m.quickActions);

  return (
    <div className={styles.container} data-panel={panel || undefined}>
      <div className={styles.header}>
        <span className={styles.title}>Refine claims</span>
        {hasRealMessages && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={onClear}
            disabled={isStreaming}
          >
            Clear
          </button>
        )}
      </div>

      <div className={styles.messages} ref={scrollRef}>
        {messages.length === 0 && (
          <p className={styles.empty}>
            Ask to refine your claims. For example: &ldquo;Make the subject shorter&rdquo; or &ldquo;Remove the second claim&rdquo;.
          </p>
        )}
        {messages.map((msg) => {
          if (msg.searchResults) {
            return (
              <SearchResultsMessage
                key={msg.id}
                searchResults={msg.searchResults}
                onPropagateAtom={onPropagateAtom}
                getSlotText={getSlotText}
              />
            );
          }
          if (msg.quickActions) {
            return (
              <QuickActionsMessage
                key={msg.id}
                actions={msg.quickActions}
                onSend={onSend}
                onAction={onAction}
                disabled={isStreaming}
              />
            );
          }
          if (msg.details && proposals && draftPosts && onPropagateAtom && searchAtomForEdit) {
            return (
              <DetailsMessage
                key={msg.id}
                proposals={proposals}
                draftPosts={draftPosts}
                nestedEdges={nestedEdges ?? []}
                derivedTriples={derivedTriples ?? []}
                approvedTripleStatuses={approvedTripleStatuses ?? []}
                tripleVaultMetrics={tripleVaultMetrics ?? new Map()}
                tripleMetricsLoading={tripleMetricsLoading ?? false}
                tripleMetricsError={tripleMetricsError ?? null}
                onPropagateAtom={onPropagateAtom}
                searchAtomForEdit={searchAtomForEdit}
                onUpdateNestedPredicate={onUpdateNestedPredicate}
                onUpdateNestedAtom={onUpdateNestedAtom}
                onUpdateDerivedTriple={onUpdateDerivedTriple}
                onSetNewTermLocal={onSetNewTermLocal}
                resolvedAtomMap={resolvedAtomMap}
                nestedTripleStatuses={nestedTripleStatuses}
                derivedCanonicalLabels={derivedCanonicalLabels}
              />
            );
          }
          return (
            <div key={msg.id}>
              <div
                className={`${styles.bubble} ${msg.role === "user" ? styles.user : styles.assistant}`}
              >
                {msg.content || (isStreaming ? "\u2026" : "")}
              </div>
              {msg.toolFeedback && msg.toolFeedback.length > 0 && (
                <div className={styles.toolFeedbackList}>
                  {msg.toolFeedback.map((fb, i) => (
                    <div key={i} className={styles.toolFeedback} data-success={fb.success}>
                      <span className={styles.toolFeedbackIcon}>{fb.success ? "\u2713" : "\u2717"}</span>
                      <span>{fb.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {error && <div className={styles.error}>{error}</div>}
      </div>

      <form className={styles.inputRow} onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder="Ask to refine..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isStreaming}
          autoComplete="off"
        />
        {isStreaming ? (
          <button type="button" className={styles.sendBtn} onClick={onStop}>
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={!input.trim()}
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
