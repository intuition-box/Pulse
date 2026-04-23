"use client";

import { Button } from "@/components/Button/Button";
import { Badge } from "@/components/Badge/Badge";
import type { ReactNode } from "react";
import type { Stance } from "@/features/post/ExtractionWorkspace/extraction";

import { labels } from "@/lib/vocabulary";
import styles from "./Composer.module.css";

type ComposerProps = {
  stance: Stance | "";
  inputText: string;
  busy: boolean;
  walletConnected: boolean;
  extracting?: boolean;
  contextDirty: boolean;
  message: string | null;
  status?: string;
  onInputChange: (value: string) => void;
  onExtract: () => void;
  onClose: () => void;
  themeSlot?: ReactNode;
  extraDisabled?: boolean;
  extraDisabledHint?: string;
  hideHeader?: boolean;
  placeholder?: string;
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  EXTRACTING: "Analyzing...",
  READY_TO_PUBLISH: "Ready",
  PUBLISHING: "Publishing...",
  PUBLISHED: "Published",
  FAILED: "Failed",
};

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  EXTRACTING: "warning",
  READY_TO_PUBLISH: "success",
  PUBLISHING: "warning",
  PUBLISHED: "success",
  FAILED: "danger",
};

type HintArgs = {
  message: string | null;
  walletConnected: boolean;
  extraDisabled?: boolean;
  extraDisabledHint?: string;
  inputText: string;
  contextDirty: boolean;
};

function computeHint({
  message,
  walletConnected,
  extraDisabled,
  extraDisabledHint,
  inputText,
  contextDirty,
}: HintArgs): string {
  if (message) return message;
  if (!walletConnected) return labels.connectWalletToAnalyze;
  if (extraDisabled && extraDisabledHint && inputText.length > 0) return extraDisabledHint;
  if (contextDirty) return labels.contentChangedWarning;
  return labels.composerHint;
}

export function Composer({
  stance,
  inputText,
  busy,
  walletConnected,
  extracting,
  contextDirty,
  message,
  status,
  onInputChange,
  onExtract,
  onClose,
  themeSlot,
  extraDisabled,
  extraDisabledHint,
  hideHeader,
  placeholder,
}: ComposerProps) {
  const actionLabel = contextDirty ? "Re-publish" : "Publish";
  const disabled = busy || !walletConnected || !!extraDisabled;

  const hint = computeHint({
    message,
    walletConnected,
    extraDisabled,
    extraDisabledHint,
    inputText,
    contextDirty,
  });
  const showHint = !!message || !walletConnected || !!extracting || contextDirty;
  const showCharCount = inputText.length > 0;
  const showCancel = hideHeader && (inputText.length > 0 || busy || !!extracting);

  const stanceClass =
    stance === "SUPPORTS" ? styles.composerSupports :
    stance === "REFUTES" ? styles.composerRefutes :
    "";

  const textareaEl = (
    <div className={styles.textareaWrap}>
      <textarea
        className={styles.textarea}
        value={inputText}
        maxLength={200}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={placeholder ?? "Write your text"}
      />
      {showCharCount && (
        <span className={`${styles.charCount} ${inputText.length >= 200 ? styles.charCountLimit : ""}`}>
          {inputText.length}/200
        </span>
      )}
    </div>
  );

  return (
    <div className={`${styles.composer} ${stanceClass}`}>
      {!hideHeader && (
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            {stance === "SUPPORTS" && <span className={styles.stanceHint} data-stance="supports">Supporting</span>}
            {stance === "REFUTES" && <span className={styles.stanceHint} data-stance="refutes">Refuting</span>}
            {status && status !== "READY_TO_PUBLISH" && (
              <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>
            )}
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close composer"
          >
            ✕
          </button>
        </div>
      )}

      <div className={styles.head}>
        <span className={styles.avatar} aria-hidden="true" />
        <div className={styles.headInput}>{textareaEl}</div>
      </div>

      <div className={styles.foot}>
        {themeSlot && <div className={styles.footThemes}>{themeSlot}</div>}
        <div className={styles.footActions}>
          {showHint && <span className={styles.footerHint}>{hint}</span>}
          {showCancel && (
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
          )}
          <Button variant="primary" size="sm" onClick={onExtract} disabled={disabled}>
            {extracting ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                {labels.analyzingStatus}
              </>
            ) : (
              actionLabel
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
