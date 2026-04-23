import styles from "./Chip.module.css";

type ChipTone = "neutral" | "supports" | "refutes" | "accent";
type ChipSize = "sm" | "md";

type ChipProps = {
  children: React.ReactNode;
  tone?: ChipTone;
  size?: ChipSize;
  as?: "button" | "span";
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  title?: string;
};

export function Chip({
  children,
  tone = "neutral",
  size = "md",
  as = "button",
  active = false,
  onClick,
  disabled,
  className,
  "aria-label": ariaLabel,
  title,
}: ChipProps) {
  const classes = [
    styles.chip,
    styles[size],
    styles[tone],
    active ? styles.active : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if (as === "span") {
    return (
      <span className={classes} title={title} aria-label={ariaLabel}>
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  );
}
