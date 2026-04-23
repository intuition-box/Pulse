// Composed display: ring + support/oppose bar + counts. Used by VoteSection + showcase.

import { Skeleton } from "@/components/Skeleton/Skeleton";
import { SentimentCircle } from "./SentimentCircle";
import styles from "./SentimentBar.module.css";

type SentimentBarProps = {
  supportPct: number;
  totalParticipants: number;
  loading?: boolean;
  forCount?: number;
  againstCount?: number;
};

export function SentimentBar({
  supportPct,
  totalParticipants,
  loading = false,
  forCount,
  againstCount,
}: SentimentBarProps) {
  const clamped = Math.min(100, Math.max(0, supportPct));
  const opposePct = 100 - clamped;
  const empty = totalParticipants === 0;

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <Skeleton height="8px" variant="rect" />
        <Skeleton width="40%" height="14px" />
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {empty && <p className={styles.emptyLabel}>No votes yet</p>}

      {/* Bar zone: two segments + percentages + center circle */}
      <div className={styles.barZone}>
        <div className={styles.barSegmentLeft}>
          {!empty && (
            <>
              <span className={styles.pctSupport}>{Math.round(clamped)}%</span>
              <div className={styles.barTrackLeft}>
                <div
                  className={styles.barSupport}
                  style={{ width: `${clamped}%` }}
                />
              </div>
            </>
          )}
          {empty && <div className={styles.barTrackLeft}><div className={styles.barEmpty} /></div>}
        </div>

        {/* Circle — always centered */}
        <SentimentCircle supportPct={clamped} totalParticipants={totalParticipants} mode="full" />

        <div className={styles.barSegmentRight}>
          {!empty && (
            <>
              <span className={styles.pctOppose}>{Math.round(opposePct)}%</span>
              <div className={styles.barTrackRight}>
                <div
                  className={styles.barOppose}
                  style={{ width: `${opposePct}%` }}
                />
              </div>
            </>
          )}
          {empty && <div className={styles.barTrackRight}><div className={styles.barEmpty} /></div>}
        </div>
      </div>

      {/* Detail row — below bar */}
      {!empty && forCount != null && againstCount != null && (
        <div className={styles.detailRow}>
          <span className={styles.detailSupport}>
            {forCount} supporter{forCount !== 1 ? "s" : ""}
          </span>
          <span className={styles.detailOppose}>
            {againstCount} opposer{againstCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
