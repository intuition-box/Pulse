"use client";

import { Button } from "@/components/Button/Button";
import { Badge } from "@/components/Badge/Badge";
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
  onStanceChange?: (stance: Stance) => void;
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
  onStanceChange,
}: ComposerProps) {
  const actionLabel = contextDirty ? "Re-analyze" : "Analyze";
  const disabled = busy || !walletConnected;

  return (
    <div className={styles.composer}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {onStanceChange ? (
            <>
              <h3 className={styles.title}>Reply as</h3>
              <div className={styles.stanceToggle}>
                <button
                  type="button"
                  className={`${styles.stanceToggleBtn} ${styles.stanceToggleSupports} ${stance === "SUPPORTS" ? styles.stanceToggleActive : ""}`}
                  onClick={() => onStanceChange("SUPPORTS")}
                >
                  Supports
                </button>
                <button
                  type="button"
                  className={`${styles.stanceToggleBtn} ${styles.stanceToggleRefutes} ${stance === "REFUTES" ? styles.stanceToggleActive : ""}`}
                  onClick={() => onStanceChange("REFUTES")}
                >
                  Refutes
                </button>
              </div>
            </>
          ) : (
            <h3 className={styles.title}>{labels.composerTitleRoot}</h3>
          )}
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

      <textarea
        className={styles.textarea}
        value={inputText}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder="Write your text"
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
      </div>
    </div>
  );
}
