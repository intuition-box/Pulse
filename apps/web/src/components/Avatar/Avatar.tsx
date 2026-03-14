import styles from "./Avatar.module.css";

type AvatarProps = {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
};

export function Avatar({ src, name, size = "md" }: AvatarProps) {
  const initial = (name || "?").charAt(0).toUpperCase();
  const classes = [styles.avatar, styles[size]].join(" ");

  if (src) {
    return (
      <div className={classes}>

        <img className={styles.img} src={src} alt={name} />
      </div>
    );
  }

  return (
    <div className={`${classes} ${styles.placeholder}`}>
      {initial}
    </div>
  );
}
