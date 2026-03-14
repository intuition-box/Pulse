"use client";

import { useState } from "react";

import { Button } from "@/components/Button/Button";

import {
  deriveDirection,
  deriveAmount,
  isNeutral,
  formatCTA,
  formatAriaValueText,
} from "./confidenceSlider.logic";
import styles from "./ConfidenceSlider.module.css";

export type ConfidenceSliderResult = {
  direction: "support" | "oppose";
  amount: number;
};

export type ConfidenceSliderProps = {
  onConfirm: (result: ConfidenceSliderResult) => void;
  busy?: boolean;
  symbol?: string;
  min?: number;
  max?: number;
  /** Existing user position direction (if any). Used to show warning on opposite side. */
  existingDirection?: "support" | "oppose" | null;
  /** Called when user clicks the back button (rendered inside the feedback row). */
  onBack?: () => void;
  className?: string;
};

export function ConfidenceSlider({
  onConfirm,
  busy = false,
  symbol = "tTRUST",
  min: _min = 1,
  max = 10,
  existingDirection = null,
  onBack,
  className,
}: ConfidenceSliderProps) {
  const [sliderValue, setSliderValue] = useState(0);

  const direction = deriveDirection(sliderValue);
  const amount = deriveAmount(sliderValue);
  const neutral = isNeutral(sliderValue);

  // Slider is always free-range; warning shown when moving to opposite side
  const isOpposite = existingDirection != null
    && direction !== "neutral"
    && direction !== existingDirection;

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSliderValue(Number(e.target.value));
  }

  function handleConfirm() {
    if (neutral || busy || isOpposite) return;
    onConfirm({
      direction: direction as "support" | "oppose",
      amount,
    });
  }

  const ctaClass = direction === "support"
    ? styles.ctaSupport
    : direction === "oppose"
      ? styles.ctaOppose
      : undefined;

  const wrapperClasses = [styles.wrapper, className].filter(Boolean).join(" ");

  return (
    <div className={wrapperClasses} data-direction={direction}>
      {/* Live feedback */}
      <div className={styles.feedback}>
        {onBack && (
          <button type="button" className={styles.feedbackBack} onClick={onBack}>
            &larr; Back
          </button>
        )}
        {neutral ? (
          <span className={styles.feedbackNeutral}>Neutral</span>
        ) : (
          <span className={styles.feedbackDirection}>
            {direction === "support" ? "Trust" : "Distrust"} {Math.round((amount / max) * 100)}%
          </span>
        )}
      </div>

      {/* Slider */}
      <div className={styles.sliderRow}>
        <span className={`${styles.sliderLabel} ${styles.sliderLabelSupport}`}>
          Support
        </span>
        <input
          type="range"
          className={styles.slider}
          min={-max}
          max={max}
          step={1}
          value={sliderValue}
          onChange={handleChange}
          disabled={busy}
          aria-label="Confidence level"
          aria-valuemin={Number(-max)}
          aria-valuemax={max}
          aria-valuenow={sliderValue}
          aria-valuetext={formatAriaValueText(sliderValue)}
        />
        <span className={`${styles.sliderLabel} ${styles.sliderLabelOppose}`}>
          Oppose
        </span>
      </div>

      {/* Opposite side warning */}
      {isOpposite && (
        <p className={styles.oppositeWarning}>
          You already {existingDirection} this claim — withdraw first to change side.
        </p>
      )}

      {/* Tick marks */}
      <div className={styles.ticks}>
        {Array.from({ length: 2 * max + 1 }, (_, i) => i - max).map((tick) => (
          <span
            key={tick}
            className={tick === 0 ? styles.tickZero : styles.tick}
          />
        ))}
      </div>

      {/* User badge */}
      {existingDirection && (
        <span className={styles.userBadge} data-side={existingDirection}>
          <span className={styles.userDot} />
          You: {existingDirection === "support" ? "Support" : "Oppose"}
        </span>
      )}

      {/* CTA */}
      <div className={ctaClass}>
        <Button
          variant="primary"
          fullWidth
          disabled={neutral || busy || isOpposite}
          onClick={handleConfirm}
        >
          {busy ? "Confirming..." : formatCTA(sliderValue, symbol)}
        </Button>
      </div>
    </div>
  );
}
