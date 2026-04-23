import styles from "./Label.module.css";

type LabelSize = "xs" | "sm";
type LabelAs = "span" | "div" | "h3";

type LabelProps = {
  children: React.ReactNode;
  size?: LabelSize;
  as?: LabelAs;
  className?: string;
};

export function Label({
  children,
  size = "sm",
  as: Tag = "span",
  className,
}: LabelProps) {
  const classes = [styles.label, styles[size], className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <Tag className={classes}>{children}</Tag>;
}
