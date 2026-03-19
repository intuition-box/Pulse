import { ReplyColumn } from "@/app/_components/ReplyColumn/ReplyColumn";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import type { ReplyNode } from "@/lib/types/reply";

import styles from "./RepliesGrid.module.css";

type ThemeItem = { slug: string; name: string };

type RepliesGridProps = {
  supportReplies: ReplyNode[];
  refuteReplies: ReplyNode[];
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  onReply?: (stance: "SUPPORTS" | "REFUTES") => void;
  sentimentMap?: SentimentMap;
  themes?: ThemeItem[];
};

export function RepliesGrid({
  supportReplies,
  refuteReplies,
  onBadgeClick,
  onReply,
  sentimentMap,
  themes,
}: RepliesGridProps) {
  return (
    <section className={styles.section}>
      <div className={styles.columns}>
        <ReplyColumn
          stance="supports"
          title="Supports"
          replies={supportReplies}
          onAdd={onReply ? () => onReply("SUPPORTS") : undefined}
          onBadgeClick={onBadgeClick}
          sentimentMap={sentimentMap}
          themes={themes}
        />
        <ReplyColumn
          stance="refutes"
          title="Refutes"
          replies={refuteReplies}
          onAdd={onReply ? () => onReply("REFUTES") : undefined}
          onBadgeClick={onBadgeClick}
          sentimentMap={sentimentMap}
          themes={themes}
        />
      </div>
    </section>
  );
}
