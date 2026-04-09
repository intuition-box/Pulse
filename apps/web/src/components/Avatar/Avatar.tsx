import styles from "./Avatar.module.css";

type AvatarProps = {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
};

const PALETTE = [
  "#CFC2A3",
  "#1a90a2",
  "#be324a",
  "#7C5CDB",
  "#DB9B5C",
  "#5CDB95",
  "#5C8BDB",
  "#DB5C9B",
] as const;

function colorFromString(input: string): string {
  if (!input) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx];
}

export function Avatar({ src, name, size = "md" }: AvatarProps) {
  const classes = [styles.avatar, styles[size]].join(" ");

  if (src) {
    return (
      <div className={classes} aria-hidden="true">
        <img className={styles.img} src={src} alt="" />
      </div>
    );
  }

  const bg = colorFromString(name);
  return (
    <div
      className={`${classes} ${styles.placeholder}`}
      style={{ background: bg }}
      aria-hidden="true"
    />
  );
}
