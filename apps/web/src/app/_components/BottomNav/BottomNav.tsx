"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, TrendingUp } from "lucide-react";

import { BurgerMenu } from "@/components/BurgerMenu/BurgerMenu";
import styles from "./BottomNav.module.css";

const TABS = [
  { href: "/", label: "Feed", icon: Home },
  { href: "/themes", label: "Explore", icon: Compass },
  { href: "/trending", label: "Trending", icon: TrendingUp },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <nav className={styles.bottomNav}>
      {TABS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`${styles.tab} ${isActive(href) ? styles.tabActive : ""}`}
        >
          <Icon className={styles.tabIcon} />
          <span>{label}</span>
        </Link>
      ))}
      <div className={styles.tab}>
        <BurgerMenu />
      </div>
    </nav>
  );
}
