import { ReplyCard } from "@/app/_components/ReplyCard/ReplyCard";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import type { ReplyNode } from "@/lib/types/reply";

import styles from "./ReplyColumn.module.css";

type Stance = "supports" | "refutes";

type ReplyColumnProps = {
  stance: Stance;
  title: string;
  replies: ReplyNode[];
  onAdd?: () => void;
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  sentimentMap?: SentimentMap;
  themeName?: string;
};

const LABELS: Record<Stance, string> = {
  supports: "No supports yet.",
  refutes: "No refutes yet.",
};

const STANCE_MAP: Record<Stance, "SUPPORTS" | "REFUTES"> = {
  supports: "SUPPORTS",
  refutes: "REFUTES",
};

export function ReplyColumn({ stance, title, replies, onAdd, onBadgeClick, sentimentMap, themeName }: ReplyColumnProps) {
  return (
    <div className={`${styles.column} ${styles[stance]}`}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>{replies.length}</span>
        {onAdd && (
          <button
            className={styles.addBtn}
            onClick={onAdd}
            aria-label={`Add ${stance} reply`}
          >
            +
          </button>
        )}
      </div>

      <div className={styles.replies}>
        {replies.length === 0 ? (
          <p className={styles.empty}>{LABELS[stance]}</p>
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
                themeName={themeName}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
