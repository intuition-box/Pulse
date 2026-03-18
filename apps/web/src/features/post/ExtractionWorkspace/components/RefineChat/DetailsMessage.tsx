"use client";

import type { CSSProperties } from "react";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Repeat2, User } from "lucide-react";
import type {
  ApprovedProposalWithRole,
  DerivedTripleDraft,
  DraftPost,
  NestedProposalDraft,
  ApprovedTripleStatus,
  AtomMeta,
} from "../../extraction";
import { safeDisplayLabel } from "../../extraction";
import type { AtomResult } from "@/lib/intuition/types";
import { normalizeLabelForChain } from "@/lib/format/normalizeLabel";
import { validateAtomRelevance, isAllowed, getReferenceBodyForProposal } from "@/lib/validation/semanticRelevance";
import type { TripleVaultMetrics } from "./useTripleVaultMetrics";
import styles from "./detailsMessage.module.css";

type EditingSlot = {
  proposalId: string;
  field: "sText" | "pText" | "oText";
};

export type DetailsMessageProps = {
  proposals: ApprovedProposalWithRole[];
  draftPosts: DraftPost[];
  nestedEdges: NestedProposalDraft[];
  derivedTriples: DerivedTripleDraft[];
  approvedTripleStatuses: ApprovedTripleStatus[];
  tripleVaultMetrics: Map<string, TripleVaultMetrics>;
  tripleMetricsLoading: boolean;
  tripleMetricsError: string | null;
  onPropagateAtom: (sourceSlotText: string, atomId: string, label: string, metrics?: { holders: number | null; marketCap: number | null }) => void;
  searchAtomForEdit: (query: string) => Promise<AtomResult[]>;
  onUpdateNestedPredicate?: (nestedId: string, label: string) => void;
  onUpdateNestedAtom?: (nestedId: string, slot: "subject" | "object", label: string) => void;
  onSetNewTermLocal?: (proposalId: string, field: "sText" | "pText" | "oText", label: string) => void;
  resolvedAtomMap?: Map<string, string>;
};

const FIELD_MAP = {
  sText: { label: "S", metaKey: "subjectMeta" as const, atomIdKey: "subjectAtomId" as const, matchedKey: "subjectMatchedLabel" as const },
  pText: { label: "P", metaKey: "predicateMeta" as const, atomIdKey: "predicateAtomId" as const, matchedKey: "predicateMatchedLabel" as const },
  oText: { label: "O", metaKey: "objectMeta" as const, atomIdKey: "objectAtomId" as const, matchedKey: "objectMatchedLabel" as const },
} as const;

type FieldKey = keyof typeof FIELD_MAP;

function formatAtomMetrics(holders: number | null, marketCap: number | null): string | null {
  if (holders == null && marketCap == null) return null;
  const parts: string[] = [];
  if (holders != null && holders > 0) parts.push(`${holders}p`);
  const roundedMarketCap = marketCap != null ? Number(marketCap.toFixed(1)) : null;
  if (roundedMarketCap != null && roundedMarketCap > 0) parts.push(`${roundedMarketCap.toFixed(1)} MC`);
  if (parts.length === 0) return null;
  return parts.join(" \u00b7 ");
}

const METRIC_ICON_SIZE = 11;

function truncateId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 5)}...${id.slice(-3)}`;
}

function lookupResolvedAtom(label: string, resolvedAtomMap?: Map<string, string>): string | null {
  if (!resolvedAtomMap) return null;
  return resolvedAtomMap.get(normalizeLabelForChain(label)) ?? null;
}

function AtomBadge({ label, resolvedAtomMap }: { label: string; resolvedAtomMap?: Map<string, string> }) {
  const termId = lookupResolvedAtom(label, resolvedAtomMap);
  if (termId) return <span className={styles.onchainId}>{truncateId(termId)}</span>;
  return <span className={styles.badgeNew}>New</span>;
}

function ScrollingLabel({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = textRef.current;
    if (!viewport || !content) return;

    const measure = () => {
      const overflow = Math.ceil(content.scrollWidth - viewport.clientWidth);
      setDistance(overflow > 4 ? overflow : 0);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [text]);

  const style = distance > 0
    ? ({
        ["--label-scroll-distance" as string]: `${distance}px`,
        ["--label-scroll-duration" as string]: `${Math.max(6, Math.round(distance / 24) + 4)}s`,
      } as CSSProperties)
    : undefined;

  return (
    <span
      ref={viewportRef}
      className={[styles.scrollingLabel, className].filter(Boolean).join(" ")}
      data-overflow={distance > 0 || undefined}
    >
      <span ref={textRef} className={styles.scrollingLabelText} style={style}>
        {text}
      </span>
    </span>
  );
}

function EditPanel({
  currentLabel,
  proposalId,
  field,
  atomMeta,
  atomError,
  searchAtomForEdit,
  onSelect,
  onSetNewTerm,
  onClose,
  onClearError,
}: {
  currentLabel: string;
  proposalId: string;
  field: FieldKey;
  atomMeta: AtomMeta | null;
  atomError?: string | null;
  searchAtomForEdit: (query: string) => Promise<AtomResult[]>;
  onSelect: (proposalId: string, field: FieldKey, sourceSlotText: string, termId: string, label: string, metrics?: { holders: number | null; marketCap: number | null }) => void;
  onSetNewTerm?: (proposalId: string, field: FieldKey, label: string) => void;
  onClose: () => void;
  onClearError?: () => void;
}) {
  const [query, setQuery] = useState(currentLabel);
  const [results, setResults] = useState<AtomResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const alternatives = useMemo(() => {
    if (!atomMeta?.alternatives) return [];
    return atomMeta.alternatives.map((a) => ({
      termId: a.termId,
      label: a.label,
      holders: a.holders,
      shares: a.shares,
      marketCap: a.marketCap,
      sharePrice: a.sharePrice,
    }));
  }, [atomMeta]);

  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: AtomResult[] = [];
    for (const r of [...alternatives, ...results]) {
      if (seen.has(r.termId)) continue;
      seen.add(r.termId);
      out.push(r);
    }
    return out;
  }, [alternatives, results]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (atomError) onClearError?.();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchAtomForEdit(value.trim());
        setResults(res);
      } catch {
      } finally {
        setSearching(false);
      }
    }, 300);
    setDebounceTimer(timer);
  };

  return (
    <div className={styles.editPanel}>
      <div className={styles.editCurrentLabel}>
        <ScrollingLabel text={currentLabel} />
      </div>
      <input
        type="text"
        className={styles.editInput}
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Search atoms..."
        autoFocus
        autoComplete="off"
      />
      <div className={styles.editResults}>
        {searching && <span className={styles.editLoading}>Searching...</span>}
        {merged.map((r) => {
          const hasMetrics = r.tripleCount != null || r.holders != null;
          return (
            <div
              key={r.termId}
              className={styles.editResultRow}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(proposalId, field, currentLabel, r.termId, r.label, { holders: r.holders, marketCap: r.marketCap })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(proposalId, field, currentLabel, r.termId, r.label, { holders: r.holders, marketCap: r.marketCap });
                }
              }}
            >
              <ScrollingLabel text={r.label} className={styles.editResultLabel} />
              <span className={styles.onchainId}>{truncateId(r.termId)}</span>
              {hasMetrics && (
                <span className={styles.editResultMetrics}>
                  {r.tripleCount != null && (
                    <span className={styles.metricChip}><Repeat2 size={METRIC_ICON_SIZE} />{r.tripleCount}</span>
                  )}
                  {r.holders != null && (
                    <span className={styles.metricChip}><User size={METRIC_ICON_SIZE} />{r.holders}</span>
                  )}
                </span>
              )}
            </div>
          );
        })}
        {!searching && merged.length === 0 && query.trim().length >= 2 && (
          <span className={styles.editLoading}>No results</span>
        )}
        {onSetNewTerm && query.trim().length >= 2 && (
          <div
            className={`${styles.editResultRow} ${styles.newAtomRow}`}
            role="button"
            tabIndex={0}
            onClick={() => { onSetNewTerm(proposalId, field, query.trim()); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSetNewTerm(proposalId, field, query.trim());
              }
            }}
          >
            <span className={styles.editResultLabel}>
              Use &ldquo;<strong>{query.trim()}</strong>&rdquo; as new term
            </span>
          </div>
        )}
      </div>
      {atomError && <p className={styles.atomError}>{atomError}</p>}
      <div className={styles.editActions}>
        <button type="button" className={styles.editClose} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function AtomRow({
  fieldKey,
  proposal,
  isEditing,
  onEdit,
  editPanel,
}: {
  fieldKey: FieldKey;
  proposal: ApprovedProposalWithRole;
  isEditing: boolean;
  onEdit: () => void;
  editPanel: React.ReactNode;
}) {
  const info = FIELD_MAP[fieldKey];
  const atomId = proposal[info.atomIdKey];
  const matchedLabel = proposal[info.matchedKey];
  const meta = proposal[info.metaKey];
  const displayLabel = safeDisplayLabel(matchedLabel, proposal[fieldKey]);
  const isNew = !atomId;

  const metricsText = !isNew && meta
    ? formatAtomMetrics(meta.selectedHolders, meta.selectedMarketCap)
    : null;

  return (
    <>
      <div className={styles.atomRow}>
        <span className={styles.atomField}>{info.label}</span>
        <ScrollingLabel text={displayLabel} className={styles.atomLabel} />
        {isNew ? (
          <span className={styles.badgeNew}>New</span>
        ) : (
          <>
            {atomId && <span className={styles.onchainId}>{truncateId(atomId)}</span>}
            {metricsText && <span className={styles.metrics}>{metricsText}</span>}
          </>
        )}
        <button type="button" className={styles.editBtn} onClick={onEdit}>
          {isEditing ? "Close" : "Edit"}
        </button>
      </div>
      {isEditing && editPanel}
    </>
  );
}

function TripleRow({
  proposal,
  tripleStatus,
  tripleMetrics,
  tripleMetricsLoading,
  tripleMetricsError,
  expandedTriple,
  editingSlot,
  atomError,
  onToggle,
  onEditSlot,
  searchAtomForEdit,
  onSelectAtom,
  onSetNewTerm,
  onClearError,
}: {
  proposal: ApprovedProposalWithRole;
  tripleStatus: ApprovedTripleStatus | undefined;
  tripleMetrics: TripleVaultMetrics | undefined;
  tripleMetricsLoading: boolean;
  tripleMetricsError: string | null;
  expandedTriple: string | null;
  editingSlot: EditingSlot | null;
  atomError: string | null;
  onToggle: (proposalId: string) => void;
  onEditSlot: (slot: EditingSlot | null) => void;
  searchAtomForEdit: (query: string) => Promise<AtomResult[]>;
  onSelectAtom: (proposalId: string, field: FieldKey, sourceSlotText: string, termId: string, label: string, metrics?: { holders: number | null; marketCap: number | null }) => void;
  onSetNewTerm?: (proposalId: string, field: FieldKey, label: string) => void;
  onClearError: () => void;
}) {
  const isExpanded = expandedTriple === proposal.id;
  const isNew = !tripleStatus?.isExisting;

  const sLabel = safeDisplayLabel(proposal.subjectMatchedLabel, proposal.sText);
  const pLabel = safeDisplayLabel(proposal.predicateMatchedLabel, proposal.pText);
  const oLabel = safeDisplayLabel(proposal.objectMatchedLabel, proposal.oText);

  const tripleTermId = tripleStatus?.tripleTermId ?? null;

  let tripleMetricsDisplay: React.ReactNode = null;
  if (isNew) {
    tripleMetricsDisplay = <span className={styles.badgeNew}>New</span>;
  } else if (tripleMetricsLoading) {
    tripleMetricsDisplay = <span className={styles.metrics}>Loading metrics...</span>;
  } else if (tripleMetricsError) {
    tripleMetricsDisplay = <span className={styles.metricsWarning}>&#9888; Metrics unavailable</span>;
  } else if (tripleMetrics) {
    const parts: string[] = [];
    if (tripleMetrics.support.holders != null) parts.push(`${tripleMetrics.support.holders} for`);
    if (tripleMetrics.oppose.holders != null) parts.push(`${tripleMetrics.oppose.holders} against`);
    const roundedMarketCap = tripleMetrics.support.marketCap != null
      ? Number(tripleMetrics.support.marketCap.toFixed(1))
      : null;
    if (roundedMarketCap != null && roundedMarketCap > 0) {
      parts.push(`${roundedMarketCap.toFixed(1)} MC`);
    }
    tripleMetricsDisplay = parts.length > 0
      ? <span className={styles.metrics}>{parts.join(" \u00b7 ")}</span>
      : <span className={styles.metrics}>&mdash;</span>;
  } else {
    tripleMetricsDisplay = <span className={styles.metrics}>&mdash;</span>;
  }

  return (
    <div className={styles.tripleRow}>
      <div
        className={styles.tripleSummary}
        role="button"
        tabIndex={0}
        onClick={() => onToggle(proposal.id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(proposal.id); } }}
      >
        <span className={styles.expandIcon} data-expanded={isExpanded}>&#9654;</span>
        <ScrollingLabel
          text={`${sLabel} | ${pLabel} | ${oLabel}`}
          className={styles.tripleInline}
        />
        <span className={styles.tripleMeta}>
          {!isNew && tripleTermId && <span className={styles.onchainId}>{truncateId(tripleTermId)}</span>}
          {tripleMetricsDisplay}
        </span>
      </div>

      {isExpanded && (
        <div className={styles.atomList}>
          {(["sText", "pText", "oText"] as const).map((fk) => {
            const isEditing = editingSlot?.proposalId === proposal.id && editingSlot?.field === fk;
            return (
              <AtomRow
                key={fk}
                fieldKey={fk}
                proposal={proposal}
                isEditing={isEditing}
                onEdit={() => onEditSlot(isEditing ? null : { proposalId: proposal.id, field: fk })}
                editPanel={
                  <EditPanel
                    currentLabel={proposal[fk]}
                    proposalId={proposal.id}
                    field={fk}
                    atomMeta={proposal[FIELD_MAP[fk].metaKey]}
                    atomError={isEditing ? atomError : null}
                    searchAtomForEdit={searchAtomForEdit}
                    onSelect={onSelectAtom}
                    onSetNewTerm={onSetNewTerm}
                    onClose={() => onEditSlot(null)}
                    onClearError={onClearError}
                  />
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function DerivedTripleExpandable({
  dt,
  expandedKey,
  onToggle,
  resolvedAtomMap,
}: {
  dt: DerivedTripleDraft;
  expandedKey: string | null;
  onToggle: (key: string) => void;
  resolvedAtomMap?: Map<string, string>;
}) {
  const isExpanded = expandedKey === dt.stableKey;

  return (
    <div className={styles.tripleRow}>
      <div
        className={styles.tripleSummary}
        role="button"
        tabIndex={0}
        onClick={() => onToggle(dt.stableKey)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(dt.stableKey); } }}
      >
        <span className={styles.expandIcon} data-expanded={isExpanded}>&#9654;</span>
        <ScrollingLabel
          text={`${dt.subject} | ${dt.predicate} | ${dt.object}`}
          className={styles.tripleInline}
        />
        <span className={styles.tripleMeta}>
          <span className={styles.badgeNew}>New</span>
        </span>
      </div>

      {isExpanded && (
        <div className={styles.atomList}>
          {([["S", dt.subject], ["P", dt.predicate], ["O", dt.object]] as const).map(([label, value]) => (
            <div key={label} className={styles.atomRow}>
              <span className={styles.atomField}>{label}</span>
              <ScrollingLabel text={value} className={styles.atomLabel} />
              <AtomBadge label={value} resolvedAtomMap={resolvedAtomMap} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NestedRow({
  edge,
  proposals,
  nestedEdges,
  derivedTriples,
  approvedTripleStatuses,
  tripleVaultMetrics,
  tripleMetricsLoading,
  tripleMetricsError,
  expandedTriple,
  expandedDerived,
  editingSlot,
  atomError,
  editingNestedPredicate,
  editingNestedAtom,
  onToggle,
  onToggleDerived,
  onEditSlot,
  onEditNestedPredicate,
  onEditNestedAtom,
  searchAtomForEdit,
  onSelectAtom,
  onSetNewTerm,
  onSelectNestedPredicate,
  onSelectNestedAtom,
  onSetNewNestedPredicate,
  onSetNewNestedAtom,
  onClearError,
  resolvedAtomMap,
}: {
  edge: NestedProposalDraft;
  proposals: ApprovedProposalWithRole[];
  nestedEdges: NestedProposalDraft[];
  derivedTriples: DerivedTripleDraft[];
  approvedTripleStatuses: ApprovedTripleStatus[];
  tripleVaultMetrics: Map<string, TripleVaultMetrics>;
  tripleMetricsLoading: boolean;
  tripleMetricsError: string | null;
  expandedTriple: string | null;
  expandedDerived: string | null;
  editingSlot: EditingSlot | null;
  atomError: string | null;
  editingNestedPredicate: string | null;
  editingNestedAtom: { nestedId: string; slot: "subject" | "object" } | null;
  onToggle: (proposalId: string) => void;
  onToggleDerived: (key: string) => void;
  onEditSlot: (slot: EditingSlot | null) => void;
  onEditNestedPredicate: (nestedId: string | null) => void;
  onEditNestedAtom: (value: { nestedId: string; slot: "subject" | "object" } | null) => void;
  searchAtomForEdit: (query: string) => Promise<AtomResult[]>;
  onSelectAtom: (proposalId: string, field: FieldKey, sourceSlotText: string, termId: string, label: string, metrics?: { holders: number | null; marketCap: number | null }) => void;
  onSetNewTerm?: (proposalId: string, field: FieldKey, label: string) => void;
  onSelectNestedPredicate?: (nestedId: string, label: string) => void;
  onSelectNestedAtom?: (nestedId: string, slot: "subject" | "object", label: string) => void;
  onSetNewNestedPredicate?: (nestedId: string, label: string) => void;
  onSetNewNestedAtom?: (nestedId: string, slot: "subject" | "object", label: string) => void;
  onClearError: () => void;
  resolvedAtomMap?: Map<string, string>;
}) {
  type Resolved =
    | { kind: "proposal"; proposal: ApprovedProposalWithRole }
    | { kind: "derived"; dt: DerivedTripleDraft }
    | { kind: "nested"; nestedEdge: NestedProposalDraft }
    | { kind: "atom"; label: string };

  const resolveRef = (ref: NestedProposalDraft["subject"]): Resolved | null => {
    if (ref.type === "triple") {
      const p = proposals.find((pr) => pr.stableKey === ref.tripleKey);
      if (p) return { kind: "proposal", proposal: p };
      const dt = derivedTriples.find((d) => d.stableKey === ref.tripleKey);
      if (dt) return { kind: "derived", dt };
      const ne = nestedEdges.find((n) => n.stableKey === ref.tripleKey && n.id !== edge.id);
      if (ne) return { kind: "nested", nestedEdge: ne };
      return null;
    }
    if (ref.type === "atom") return { kind: "atom", label: ref.label };
    return null;
  };

  const subjectResolved = resolveRef(edge.subject);
  const objectResolved = resolveRef(edge.object);

  const renderRef = (resolved: Resolved, slotLabel: string) => {
    if (resolved.kind === "proposal") {
      const status = approvedTripleStatuses.find((s) => s.proposalId === resolved.proposal.id);
      const termId = status?.tripleTermId ?? null;
      return (
        <TripleRow
          proposal={resolved.proposal}
          tripleStatus={status}
          tripleMetrics={termId ? tripleVaultMetrics.get(termId) : undefined}
          tripleMetricsLoading={tripleMetricsLoading}
          tripleMetricsError={tripleMetricsError}
          expandedTriple={expandedTriple}
          editingSlot={editingSlot}
          atomError={atomError}
          onToggle={onToggle}
          onEditSlot={onEditSlot}
          searchAtomForEdit={searchAtomForEdit}
          onSelectAtom={onSelectAtom}
          onSetNewTerm={onSetNewTerm}
          onClearError={onClearError}
        />
      );
    }
    if (resolved.kind === "derived") {
      return (
        <DerivedTripleExpandable
          dt={resolved.dt}
          expandedKey={expandedDerived}
          onToggle={onToggleDerived}
          resolvedAtomMap={resolvedAtomMap}
        />
      );
    }
    if (resolved.kind === "nested") {
      return (
        <div className={styles.nestedRow}>
          <NestedRow
            edge={resolved.nestedEdge}
            proposals={proposals}
            nestedEdges={nestedEdges}
            derivedTriples={derivedTriples}
            approvedTripleStatuses={approvedTripleStatuses}
            tripleVaultMetrics={tripleVaultMetrics}
            tripleMetricsLoading={tripleMetricsLoading}
            tripleMetricsError={tripleMetricsError}
            expandedTriple={expandedTriple}
            expandedDerived={expandedDerived}
            editingSlot={editingSlot}
            atomError={atomError}
            editingNestedPredicate={editingNestedPredicate}
            editingNestedAtom={editingNestedAtom}
            onToggle={onToggle}
            onToggleDerived={onToggleDerived}
            onEditSlot={onEditSlot}
            onEditNestedPredicate={onEditNestedPredicate}
            onEditNestedAtom={onEditNestedAtom}
            searchAtomForEdit={searchAtomForEdit}
            onSelectAtom={onSelectAtom}
            onSetNewTerm={onSetNewTerm}
            onSelectNestedPredicate={onSelectNestedPredicate}
            onSelectNestedAtom={onSelectNestedAtom}
            onSetNewNestedPredicate={onSetNewNestedPredicate}
            onSetNewNestedAtom={onSetNewNestedAtom}
            onClearError={onClearError}
            resolvedAtomMap={resolvedAtomMap}
          />
        </div>
      );
    }
    const slot = slotLabel === "S" ? "subject" as const : "object" as const;
    const isEditingAtom = editingNestedAtom?.nestedId === edge.id && editingNestedAtom?.slot === slot;

    return (
      <>
        <div className={styles.atomRow}>
          <span className={styles.atomField}>{slotLabel}</span>
          <ScrollingLabel text={resolved.label} className={styles.atomLabel} />
          <AtomBadge label={resolved.label} resolvedAtomMap={resolvedAtomMap} />
          {onSelectNestedAtom && (
            <button
              type="button"
              className={styles.editBtn}
              onClick={() => onEditNestedAtom(isEditingAtom ? null : { nestedId: edge.id, slot })}
            >
              {isEditingAtom ? "Close" : "Edit"}
            </button>
          )}
        </div>
        {isEditingAtom && onSelectNestedAtom && (
          <EditPanel
            currentLabel={resolved.label}
            proposalId={edge.id}
            field={slot === "subject" ? "sText" : "oText"}
            atomMeta={null}
            atomError={isEditingAtom ? atomError : null}
            searchAtomForEdit={searchAtomForEdit}
            onSelect={(_pid, _field, _src, _termId, label) => {
              onSelectNestedAtom(edge.id, slot, label);
            }}
            onSetNewTerm={
              onSetNewNestedAtom
                ? (_pid, _field, label) => {
                    onSetNewNestedAtom(edge.id, slot, label);
                  }
                : undefined
            }
            onClose={() => onEditNestedAtom(null)}
            onClearError={onClearError}
          />
        )}
      </>
    );
  };

  const isEditingPredicate = editingNestedPredicate === edge.id;

  return (
    <>
      {subjectResolved && renderRef(subjectResolved, "S")}
      <div className={styles.atomRow}>
        <span className={styles.atomField}>P</span>
        <span className={styles.atomLabel}>{edge.predicate}</span>
        <AtomBadge label={edge.predicate} resolvedAtomMap={resolvedAtomMap} />
        {onSelectNestedPredicate && (
          <button
            type="button"
            className={styles.editBtn}
            onClick={() => onEditNestedPredicate(isEditingPredicate ? null : edge.id)}
          >
            {isEditingPredicate ? "Close" : "Edit"}
          </button>
        )}
      </div>
      {isEditingPredicate && onSelectNestedPredicate && (
        <EditPanel
          currentLabel={edge.predicate}
          proposalId={edge.id}
          field="pText"
          atomMeta={null}
          atomError={isEditingPredicate ? atomError : null}
          searchAtomForEdit={searchAtomForEdit}
          onSelect={(_pid, _field, _src, _termId, label) => {
            onSelectNestedPredicate(edge.id, label);
          }}
          onSetNewTerm={
            onSetNewNestedPredicate
              ? (_pid, _field, label) => {
                  onSetNewNestedPredicate(edge.id, label);
                }
              : undefined
          }
          onClose={() => onEditNestedPredicate(null)}
          onClearError={onClearError}
        />
      )}
      {objectResolved && renderRef(objectResolved, "O")}
    </>
  );
}

export function DetailsMessage({
  proposals,
  draftPosts,
  nestedEdges,
  derivedTriples,
  approvedTripleStatuses,
  tripleVaultMetrics,
  tripleMetricsLoading,
  tripleMetricsError,
  onPropagateAtom,
  searchAtomForEdit,
  onUpdateNestedPredicate,
  onUpdateNestedAtom,
  onSetNewTermLocal,
  resolvedAtomMap,
}: DetailsMessageProps) {
  const [expandedTriple, setExpandedTriple] = useState<string | null>(null);
  const [expandedDerived, setExpandedDerived] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<EditingSlot | null>(null);
  const [editingNestedPredicate, setEditingNestedPredicate] = useState<string | null>(null);
  const [editingNestedAtom, setEditingNestedAtom] = useState<{ nestedId: string; slot: "subject" | "object" } | null>(null);
  const [atomError, setAtomError] = useState<string | null>(null);

  const handleToggle = (proposalId: string) => {
    setExpandedTriple((prev) => (prev === proposalId ? null : proposalId));
    setEditingSlot(null);
    setEditingNestedPredicate(null);
    setEditingNestedAtom(null);
    setAtomError(null);
  };

  const handleToggleDerived = (key: string) => {
    setExpandedDerived((prev) => (prev === key ? null : key));
  };

  const handleEditSlot = (slot: EditingSlot | null) => {
    setEditingSlot(slot);
    setEditingNestedPredicate(null);
    setEditingNestedAtom(null);
    setAtomError(null);
  };

  const handleEditNestedPredicate = (nestedId: string | null) => {
    setEditingNestedPredicate(nestedId);
    setEditingNestedAtom(null);
    setEditingSlot(null);
    setAtomError(null);
  };

  const handleEditNestedAtom = (value: { nestedId: string; slot: "subject" | "object" } | null) => {
    setEditingNestedAtom(value);
    setEditingNestedPredicate(null);
    setEditingSlot(null);
    setAtomError(null);
  };

  const handleSelectNestedPredicate = onUpdateNestedPredicate
    ? (nestedId: string, label: string) => {
        onUpdateNestedPredicate(nestedId, label);
        setEditingNestedPredicate(null);
        setAtomError(null);
      }
    : undefined;

  const handleSetNewNestedPredicate = handleSelectNestedPredicate;

  const handleSelectNestedAtom = onUpdateNestedAtom
    ? (nestedId: string, slot: "subject" | "object", label: string) => {
        onUpdateNestedAtom(nestedId, slot, label);
        setEditingNestedAtom(null);
        setAtomError(null);
      }
    : undefined;

  const handleSetNewNestedAtom = handleSelectNestedAtom;

  const handleSelectAtom = (proposalId: string, field: FieldKey, sourceSlotText: string, termId: string, label: string, metrics?: { holders: number | null; marketCap: number | null }) => {
    const body = getReferenceBodyForProposal(proposalId, draftPosts);
    if (body) {
      const check = validateAtomRelevance(label, body, field);
      if (!isAllowed(check)) {
        setAtomError(check.reason ?? "This atom is not related to the post text.");
        return;
      }
    }
    setAtomError(null);
    onPropagateAtom(sourceSlotText, termId, label, metrics);
    setEditingSlot(null);
  };

  const handleSetNewTermLocal = useCallback(
    (proposalId: string, field: "sText" | "pText" | "oText", label: string) => {
      if (!onSetNewTermLocal) return;
      const body = getReferenceBodyForProposal(proposalId, draftPosts);
      if (body) {
        const check = validateAtomRelevance(label, body, field);
        if (!isAllowed(check)) {
          setAtomError(check.reason ?? "This term is not related to the post text.");
          return;
        }
      }
      setAtomError(null);
      onSetNewTermLocal(proposalId, field, label);
      setEditingSlot(null);
    },
    [onSetNewTermLocal, draftPosts],
  );

  const draftData = useMemo(() => {
    const nestedSubTripleKeys = new Set<string>();
    for (const e of nestedEdges) {
      for (const ref of [e.subject, e.object]) {
        if (ref.type === "triple") nestedSubTripleKeys.add(ref.tripleKey);
      }
    }

    return draftPosts.map((draft) => {
      const edgeBelongsToDraft = (e: NestedProposalDraft, visited = new Set<string>()): boolean => {
        if (visited.has(e.stableKey)) return false;
        visited.add(e.stableKey);
        for (const ref of [e.subject, e.object]) {
          if (ref.type !== "triple") continue;
          // Check ALL proposals with matching stableKey (causal splits create
          // duplicate main proposals with different groupKeys / IDs)
          if (proposals.some((pr) => pr.stableKey === ref.tripleKey && draft.proposalIds.includes(pr.id))) return true;
          const ne = nestedEdges.find((n) => n.stableKey === ref.tripleKey);
          if (ne && edgeBelongsToDraft(ne, visited)) return true;
        }
        return false;
      };

      const draftNestedEdges = nestedEdges.filter((e) => {
        if (nestedSubTripleKeys.has(e.stableKey)) return false;
        return edgeBelongsToDraft(e);
      });
      const mainProposal = proposals.find(
        (p) => p.id === draft.mainProposalId && p.status === "approved",
      );
      const draftGroupKeys = new Set(
        draft.proposalIds
          .map((pid) => proposals.find((pr) => pr.id === pid))
          .filter(Boolean)
          .map((p) => p!.groupKey),
      );
      // Check if the edge's object triple belongs to this draft (proposal OR derived triple)
      const objectInDraft = (e: NestedProposalDraft) => {
        if (e.object.type !== "triple") return false;
        const tripleKey = e.object.tripleKey;
        const p = proposals.find((pr) => pr.stableKey === tripleKey);
        if (p && draft.proposalIds.includes(p.id)) return true;
        const dt = derivedTriples.find((d) => d.stableKey === tripleKey);
        if (dt && draftGroupKeys.has(dt.ownerGroupKey)) return true;
        return false;
      };
      const mainNestedEdge = (() => {
        if (mainProposal?.outermostMainKey) {
          const found = draftNestedEdges.find((e) => e.stableKey === mainProposal.outermostMainKey);
          if (found && (found.edgeKind !== "relation" || objectInDraft(found))) return found;
        }
        return draftNestedEdges.find((e) => e.edgeKind === "relation" && objectInDraft(e)) ?? null;
      })();
      const otherNestedEdges = draftNestedEdges.filter((e) => {
        if (mainNestedEdge && e.id === mainNestedEdge.id) return false;
        if (e.edgeKind === "relation") return false;
        return true;
      });
      const draftProposals = proposals.filter(
        (p) => draft.proposalIds.includes(p.id) && p.status === "approved"
          // Only hide sub-triples when their parent NestedRow exists to display them
          && !(mainNestedEdge && nestedSubTripleKeys.has(p.stableKey))
          && !(mainNestedEdge && p.id === draft.mainProposalId),
      );
      return { draft, draftProposals, mainNestedEdge, otherNestedEdges };
    });
  }, [draftPosts, proposals, nestedEdges, derivedTriples]);

  return (
    <div className={styles.container}>
      {draftData.map(({ draft, draftProposals, mainNestedEdge, otherNestedEdges }, i) => (
        <div key={draft.id} className={styles.postGroup}>
          {draftPosts.length > 1 && (
            <span className={styles.postHeader}>Post {i + 1}</span>
          )}
          {mainNestedEdge && (
            <NestedRow
              key={mainNestedEdge.id}
              edge={mainNestedEdge}
              proposals={proposals}
              nestedEdges={nestedEdges}
              derivedTriples={derivedTriples}
              approvedTripleStatuses={approvedTripleStatuses}
              tripleVaultMetrics={tripleVaultMetrics}
              tripleMetricsLoading={tripleMetricsLoading}
              tripleMetricsError={tripleMetricsError}
              expandedTriple={expandedTriple}
              expandedDerived={expandedDerived}
              editingSlot={editingSlot}
              atomError={atomError}
              editingNestedPredicate={editingNestedPredicate}
              editingNestedAtom={editingNestedAtom}
              onToggle={handleToggle}
              onToggleDerived={handleToggleDerived}
              onEditSlot={handleEditSlot}
              onEditNestedPredicate={handleEditNestedPredicate}
              onEditNestedAtom={handleEditNestedAtom}
              searchAtomForEdit={searchAtomForEdit}
              onSelectAtom={handleSelectAtom}
              onSetNewTerm={onSetNewTermLocal ? handleSetNewTermLocal : undefined}
              onSelectNestedPredicate={handleSelectNestedPredicate}
              onSelectNestedAtom={handleSelectNestedAtom}
              onSetNewNestedPredicate={handleSetNewNestedPredicate}
              onSetNewNestedAtom={handleSetNewNestedAtom}
              onClearError={() => setAtomError(null)}
              resolvedAtomMap={resolvedAtomMap}
            />
          )}
          {draftProposals.map((p) => {
            const status = approvedTripleStatuses.find((s) => s.proposalId === p.id);
            const termId = status?.tripleTermId ?? null;
            return (
              <TripleRow
                key={p.id}
                proposal={p}
                tripleStatus={status}
                tripleMetrics={termId ? tripleVaultMetrics.get(termId) : undefined}
                tripleMetricsLoading={tripleMetricsLoading}
                tripleMetricsError={tripleMetricsError}
                expandedTriple={expandedTriple}
                editingSlot={editingSlot}
                atomError={atomError}
                onToggle={handleToggle}
                onEditSlot={handleEditSlot}
                searchAtomForEdit={searchAtomForEdit}
                onSelectAtom={handleSelectAtom}
                onSetNewTerm={onSetNewTermLocal ? handleSetNewTermLocal : undefined}
                onClearError={() => setAtomError(null)}
              />
            );
          })}
          {otherNestedEdges.map((edge) => (
            <NestedRow
              key={edge.id}
              edge={edge}
              proposals={proposals}
              nestedEdges={nestedEdges}
              derivedTriples={derivedTriples}
              approvedTripleStatuses={approvedTripleStatuses}
              tripleVaultMetrics={tripleVaultMetrics}
              tripleMetricsLoading={tripleMetricsLoading}
              tripleMetricsError={tripleMetricsError}
              expandedTriple={expandedTriple}
              expandedDerived={expandedDerived}
              editingSlot={editingSlot}
              atomError={atomError}
              editingNestedPredicate={editingNestedPredicate}
              editingNestedAtom={editingNestedAtom}
              onToggle={handleToggle}
              onToggleDerived={handleToggleDerived}
              onEditSlot={handleEditSlot}
              onEditNestedPredicate={handleEditNestedPredicate}
              onEditNestedAtom={handleEditNestedAtom}
              searchAtomForEdit={searchAtomForEdit}
              onSelectAtom={handleSelectAtom}
              onSetNewTerm={onSetNewTermLocal ? handleSetNewTermLocal : undefined}
              onSelectNestedPredicate={handleSelectNestedPredicate}
              onSelectNestedAtom={handleSelectNestedAtom}
              onSetNewNestedPredicate={handleSetNewNestedPredicate}
              onSetNewNestedAtom={handleSetNewNestedAtom}
              onClearError={() => setAtomError(null)}
              resolvedAtomMap={resolvedAtomMap}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
