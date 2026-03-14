import type { HTMLAttributes } from "react";

import styles from "./Card.module.css";

type CardProps = HTMLAttributes<HTMLDivElement> & { interactive?: boolean };

export function Card({ className, interactive, ...props }: CardProps) {
  const classes = [styles.card, interactive && styles.interactive, className].filter(Boolean).join(" ");
  return <div className={classes} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const classes = [styles.header, className].filter(Boolean).join(" ");
  return <div className={classes} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const classes = [styles.title, className].filter(Boolean).join(" ");
  return <h3 className={classes} {...props} />;
}

export function CardMeta({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const classes = [styles.meta, className].filter(Boolean).join(" ");
  return <p className={classes} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const classes = [styles.body, className].filter(Boolean).join(" ");
  return <div className={classes} {...props} />;
}
