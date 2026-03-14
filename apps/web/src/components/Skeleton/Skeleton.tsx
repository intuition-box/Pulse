import styles from "./Skeleton.module.css";

type SkeletonProps = {
  variant?: "text" | "circle" | "rect";
  width?: string;
  height?: string;
};

export function Skeleton({ variant = "text", width, height }: SkeletonProps) {
  const classes = [styles.skeleton, styles[variant]].join(" ");

  return <div className={classes} style={{ width, height }} />;
}
