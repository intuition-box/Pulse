import type { ReactNode } from "react";

import styles from "./TripleInline.module.css";

type TripleInlineProps = {
  subject: ReactNode;
  predicate: ReactNode;
  object: ReactNode;
  wrap?: boolean;
  nested?: boolean;
  subjectNested?: boolean;
  objectNested?: boolean;
};

export function TripleInline({
  subject,
  predicate,
  object,
  wrap,
  nested,
  subjectNested,
  objectNested,
}: TripleInlineProps) {
  const cls = [
    styles.tripleRow,
    wrap ? styles.wrap : "",
    nested ? styles.nested : "",
  ].filter(Boolean).join(" ");
  return (
    <span className={cls}>
      <span className={subjectNested ? styles.nested : undefined}>{subject}</span>
      <span className={styles.separator}>·</span>
      <span>{predicate}</span>
      <span className={styles.separator}>·</span>
      <span className={objectNested ? styles.nested : undefined}>{object}</span>
    </span>
  );
}
