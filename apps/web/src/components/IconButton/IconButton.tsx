import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

import styles from "./IconButton.module.css";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  size?: "sm" | "md";
  label: string;
};

const iconSizeMap = { sm: 16, md: 18 } as const;

export function IconButton({
  icon: Icon,
  size = "sm",
  label,
  className,
  ...props
}: IconButtonProps) {
  const classes = [styles.iconButton, styles[size], className]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} aria-label={label} {...props}>
      <Icon size={iconSizeMap[size]} />
    </button>
  );
}
