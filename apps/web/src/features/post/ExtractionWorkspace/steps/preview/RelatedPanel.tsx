import { useMemo } from "react";

import { DebateCardView, type DebatePostData } from "@/app/_components/DebateThread/DebateCardView";
import { labels } from "@/lib/vocabulary";

import type { DuplicateInfo } from "../../hooks/useDuplicateCheck";
import styles from "../../ExtractionWorkspace.module.css";

type RelatedPanelProps = {
  duplicatesByDraft: Map<string, DuplicateInfo[]>;
};

export function RelatedPanel({ duplicatesByDraft }: RelatedPanelProps) {
  const unique = useMemo(() => {
    const all: DuplicateInfo[] = [];
    for (const dups of duplicatesByDraft.values()) {
      for (const d of dups) {
        if (!d.isBlocking) all.push(d);
      }
    }
    const seen = new Set<string>();
    return all.filter((d) => {
      if (seen.has(d.postId)) return false;
      seen.add(d.postId);
      return true;
    });
  }, [duplicatesByDraft]);

  if (unique.length === 0) return null;

  return (
    <div className={styles.relatedPanel}>
      <p className={styles.relatedTitle}>{labels.duplicateRelatedTitle}</p>
      {unique.map((d) => {
        const postData: DebatePostData = {
          id: d.postId,
          body: d.postBody,
          createdAt: d.createdAt,
          user: {
            displayName: d.authorDisplayName,
            address: d.authorAddress,
            avatar: d.authorAvatar,
          },
          replyCount: d.replyCount,
        };
        return (
          <div key={d.postId} className={styles.relatedItem}>
            {d.parentPostBody && (
              <p className={styles.relatedContext}>
                ↩ {d.parentPostBody}
              </p>
            )}
            <DebateCardView post={postData} dense linkTarget="_blank" />
          </div>
        );
      })}
    </div>
  );
}
