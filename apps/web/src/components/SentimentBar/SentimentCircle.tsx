// Atom display: single ring + compact number. Used by DebateCardView + SentimentBar.

import styles from "./SentimentCircle.module.css";

type SentimentCircleProps = {
  supportPct: number;
  totalParticipants: number;
  mode?: "full" | "compact" | "micro" | "tiny";
};

const SUPPORT_COLOR = "var(--stance-supports-text)";
const OPPOSE_COLOR = "var(--stance-refutes-text)";
const EMPTY_COLOR = "var(--border-default)";

const SIZES = { full: 52, compact: 32, micro: 22, tiny: 18 } as const;
const STROKES = { full: 4, compact: 3, micro: 2, tiny: 4 } as const;

export function SentimentCircle({
  supportPct,
  totalParticipants,
  mode = "compact",
}: SentimentCircleProps) {
  const clamped = Math.min(100, Math.max(0, supportPct));
  const empty = totalParticipants === 0;

  const ariaLabel = empty
    ? "No votes yet"
    : `${totalParticipants} votes — ${Math.round(clamped)}% support`;

  const size = SIZES[mode];
  const strokeWidth = STROKES[mode];
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const center = size / 2;

  const supportLen = (clamped / 100) * circumference;
  const opposeLen = circumference - supportLen;

  const cls = [styles.wrapper, styles[mode]].filter(Boolean).join(" ");

  // Tiny: CSS conic-gradient donut (matches PULSE preview) — no SVG, no inner text.
  if (mode === "tiny") {
    const supportColor = "var(--stance-supports-accent)";
    const refutesColor = "var(--stance-refutes-accent)";
    const border = "var(--border-default)";
    const background = empty
      ? border
      : `conic-gradient(${supportColor} 0% ${clamped}%, ${refutesColor} ${clamped}% 100%)`;
    return (
      <span
        className={`${styles.wrapper} ${styles.tiny}`}
        aria-label={ariaLabel}
        role="img"
        style={{ background }}
      />
    );
  }

  return (
    <div className={cls} aria-label={ariaLabel} role="img">
      <svg
        className={styles.ring}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
      >
        {empty ? (
          <circle
            cx={center}
            cy={center}
            r={r}
            fill="none"
            stroke={EMPTY_COLOR}
            strokeWidth={strokeWidth}
          />
        ) : (
          <>
            {supportLen > 0 && (
              <circle
                cx={center}
                cy={center}
                r={r}
                fill="none"
                stroke={SUPPORT_COLOR}
                strokeWidth={strokeWidth}
                strokeDasharray={`${supportLen} ${circumference}`}
                strokeLinecap="round"
                transform={`rotate(90 ${center} ${center})`}
              />
            )}
            {opposeLen > 0 && (
              <circle
                cx={center}
                cy={center}
                r={r}
                fill="none"
                stroke={OPPOSE_COLOR}
                strokeWidth={strokeWidth}
                strokeDasharray={`${opposeLen} ${circumference}`}
                strokeDashoffset={-supportLen}
                strokeLinecap="round"
                transform={`rotate(90 ${center} ${center})`}
              />
            )}
          </>
        )}
      </svg>

      {mode === "full" && (
        <div className={styles.content}>
          <span className={styles.number}>{totalParticipants}</span>
          <span className={styles.label}>votes</span>
        </div>
      )}
      {(mode === "compact" || mode === "micro") && !empty && (
        <span className={styles.compactNumber}>{totalParticipants}</span>
      )}
      {/* tiny mode: donut only, no inner text — caller renders % adjacent */}
    </div>
  );
}
