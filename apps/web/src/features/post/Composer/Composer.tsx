"use client";

import { Button } from "@/components/Button/Button";
import { Badge } from "@/components/Badge/Badge";
import type { ReactNode } from "react";
import type { Stance } from "@/features/post/ExtractionWorkspace/extraction";

import { InfoHint } from "@/components/InfoHint/InfoHint";
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
  const actionLabel = contextDirty ? "Re-submit" : "Submit";
  const disabled = busy || !walletConnected || !!extraDisabled;

  return (
    <div className={styles.composer}>
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

      {themeSlot && <div className={styles.themeSlot}>{themeSlot}</div>}

      <textarea
        className={`${styles.textarea} ${stance === "SUPPORTS" ? styles.textareaSupports : stance === "REFUTES" ? styles.textareaRefutes : ""}`}
        value={inputText}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder={placeholder ?? "Write your text"}
      />
      {message
        ? <InfoHint variant="warning">{message}</InfoHint>
        : <InfoHint variant="tip">{labels.composerHint}</InfoHint>
      }

      <div className={styles.footer}>
        <Button
          variant="primary"
          size="sm"
          onClick={onExtract}
          disabled={disabled}
        >
          {extracting ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              {labels.analyzingStatus}
            </>
          ) : (
            actionLabel
          )}
        </Button>
        {contextDirty && (
          <span className={styles.warning}>
            {labels.contentChangedWarning}
          </span>
        )}
        {!walletConnected && (
          <span className={styles.warning}>{labels.connectWalletToAnalyze}</span>
        )}
        {walletConnected && extraDisabled && extraDisabledHint && (
          <span className={styles.warning}>{extraDisabledHint}</span>
        )}
      </div>
    </div>
  );
}
