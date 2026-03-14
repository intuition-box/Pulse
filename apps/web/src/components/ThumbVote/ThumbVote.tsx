import { useEffect, useRef, useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import styles from "./ThumbVote.module.css";

type ThumbVoteProps = {
  forCount: number;
  againstCount: number;
  userDirection: "support" | "oppose" | null;
  onVote: (direction: "support" | "oppose") => void;
  busy: boolean;
  busyDirection?: "support" | "oppose" | null;
  disabled?: boolean;
  size?: "sm" | "md";
};

export function ThumbVote({
  forCount,
  againstCount,
  userDirection,
  onVote,
  busy,
  busyDirection = null,
  disabled = false,
  size = "sm",
}: ThumbVoteProps) {
  const iconSize = size === "sm" ? 14 : 18;
  const [bouncing, setBouncing] = useState<"support" | "oppose" | null>(null);
  const prevBusy = useRef(busy);
  const prevDirection = useRef(userDirection);

  // Trigger animation after vote confirmation (busy true→false + direction changed)
  useEffect(() => {
    if (prevBusy.current && !busy && userDirection !== prevDirection.current && userDirection) {
      const dir = userDirection;
      // Defer setState to avoid synchronous cascade (react-hooks/set-state-in-effect)
      const startTimer = setTimeout(() => setBouncing(dir), 0);
      const endTimer = setTimeout(() => setBouncing(null), 600);
      return () => { clearTimeout(startTimer); clearTimeout(endTimer); };
    }
    prevBusy.current = busy;
    prevDirection.current = userDirection;
  }, [busy, userDirection]);

  function btnClass(dir: "support" | "oppose") {
    const active = dir === "support" ? styles.activeSupport : styles.activeOppose;
    return [
      styles.btn,
      userDirection === dir && active,
      bouncing === dir && styles.voteBounce,
      bouncing === dir && styles.floatUp,
    ].filter(Boolean).join(" ");
  }

  return (
    <div className={`${styles.wrapper} ${styles[size]}`}>
      <button
        type="button"
        className={btnClass("support")}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onVote("support");
        }}
        disabled={disabled || busy}
        aria-label={`Support (${forCount})`}
        data-float={bouncing === "support" ? "+1" : ""}
      >
        {busy && busyDirection === "support" ? (
          <Loader2 size={iconSize} className={styles.spinner} />
        ) : (
          <ThumbsUp size={iconSize} />
        )}
        <span className={styles.count}>{forCount}</span>
      </button>

      <button
        type="button"
        className={btnClass("oppose")}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onVote("oppose");
        }}
        disabled={disabled || busy}
        aria-label={`Oppose (${againstCount})`}
        data-float={bouncing === "oppose" ? "+1" : ""}
      >
        {busy && busyDirection === "oppose" ? (
          <Loader2 size={iconSize} className={styles.spinner} />
        ) : (
          <ThumbsDown size={iconSize} />
        )}
        <span className={styles.count}>{againstCount}</span>
      </button>
    </div>
  );
}
