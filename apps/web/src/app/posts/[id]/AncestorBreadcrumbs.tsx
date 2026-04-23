import Link from "next/link";

import styles from "./AncestorBreadcrumbs.module.css";

type AncestorBreadcrumbsProps = {
  breadcrumbs: { id: string; body: string }[];
};

export function AncestorBreadcrumbs({ breadcrumbs }: AncestorBreadcrumbsProps) {
  if (breadcrumbs.length === 0) return null;

  return (
    <nav aria-label="Post ancestors">
      <ol className={styles.ancestors}>
        {breadcrumbs.slice(-3).map((ancestor) => (
          <li key={ancestor.id} className={styles.item}>
            <Link href={`/posts/${ancestor.id}`} className={styles.card}>
              <p className={styles.body}>{ancestor.body}</p>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
