import { ReplyCard } from "@/app/_components/ReplyCard/ReplyCard";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import type { ReplyNode } from "@/lib/types/reply";

import styles from "./ReplyColumn.module.css";

type Stance = "supports" | "refutes";

type ThemeItem = { slug: string; name: string };

type ReplyColumnProps = {
  stance: Stance;
  title: string;
  replies: ReplyNode[];
  onAdd?: () => void;
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  sentimentMap?: SentimentMap;
  themes?: ThemeItem[];
};

const EMPTY_LABELS: Record<Stance, string> = {
  supports: "No supports yet.",
  refutes: "No refutes yet.",
};

const CTA_LABELS: Record<Stance, string> = {
  supports: "Be the first to support",
  refutes: "Be the first to refute",
};

const ADD_LABELS: Record<Stance, string> = {
  supports: "Add yours",
  refutes: "Add yours",
};

const STANCE_MAP: Record<Stance, "SUPPORTS" | "REFUTES"> = {
  supports: "SUPPORTS",
  refutes: "REFUTES",
};

export function ReplyColumn({ stance, title, replies, onAdd, onBadgeClick, sentimentMap, themes }: ReplyColumnProps) {
  return (
    <div className={`${styles.column} ${styles[stance]}`}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>{replies.length}</span>
        {onAdd && replies.length > 0 && (
          <button
            className={styles.addBtn}
            onClick={onAdd}
            aria-label={`Add ${stance} reply`}
          >
            {ADD_LABELS[stance]}
          </button>
        )}
      </div>

      <div className={styles.replies}>
        {replies.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.empty}>{EMPTY_LABELS[stance]}</p>
            {onAdd && (
              <button className={styles.ctaBtn} onClick={onAdd}>
                {CTA_LABELS[stance]}
              </button>
            )}
          </div>
        ) : (
          replies.map((reply) => {
            const mainTripleTermId = reply.mainTripleTermIds?.[0];
            return (
              <ReplyCard
                key={reply.id}
                id={reply.id}
                body={reply.body}
                createdAt={reply.createdAt}
                replyCount={reply.replyCount}
                author={reply.author}
                stance={STANCE_MAP[stance]}
                variant="default"
                mainTripleTermId={mainTripleTermId}
                mainTripleTermIds={reply.mainTripleTermIds}
                sentimentData={mainTripleTermId ? sentimentMap?.[mainTripleTermId] ?? null : null}
                onBadgeClick={onBadgeClick}
                themes={themes}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
