import { Label } from "@/components/Label/Label";

import styles from "./StatsBar.module.css";

type Props = {
  posts: number;
  replies: number;
  postsDelta?: number;
  repliesDelta?: number;
};

function formatDelta(n: number | undefined): string | null {
  if (!n || n === 0) return null;
  return n > 0 ? `+${n}` : `${n}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function StatsBar({ posts, replies, postsDelta, repliesDelta }: Props) {
  const pd = formatDelta(postsDelta);
  const rd = formatDelta(repliesDelta);
  return (
    <dl className={styles.bar}>
      <div className={styles.stat}>
        <dt><Label size="xs">Total posts</Label></dt>
        <dd className={styles.value}>
          {formatNumber(posts)}
          {pd && <span className={styles.delta}>{pd} 24h</span>}
        </dd>
      </div>
      <div className={styles.stat}>
        <dt><Label size="xs">Total replies</Label></dt>
        <dd className={styles.value}>
          {formatNumber(replies)}
          {rd && <span className={styles.delta}>{rd} 24h</span>}
        </dd>
      </div>
    </dl>
  );
}
