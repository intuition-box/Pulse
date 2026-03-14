import { ReplyColumn } from "@/app/_components/ReplyColumn/ReplyColumn";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import type { ReplyNode } from "@/lib/types/reply";

import styles from "./RepliesGrid.module.css";

type RepliesGridProps = {
  supportReplies: ReplyNode[];
  refuteReplies: ReplyNode[];
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  sentimentMap?: SentimentMap;
  themeName?: string;
};

export function RepliesGrid({
  supportReplies,
  refuteReplies,
  onBadgeClick,
  sentimentMap,
  themeName,
}: RepliesGridProps) {
  return (
    <section className={styles.section}>
      <div className={styles.columns}>
        <ReplyColumn
          stance="supports"
          title="Supports"
          replies={supportReplies}
          onBadgeClick={onBadgeClick}
          sentimentMap={sentimentMap}
          themeName={themeName}
        />
        <ReplyColumn
          stance="refutes"
          title="Refutes"
          replies={refuteReplies}
          onBadgeClick={onBadgeClick}
          sentimentMap={sentimentMap}
          themeName={themeName}
        />
      </div>
    </section>
  );
}
