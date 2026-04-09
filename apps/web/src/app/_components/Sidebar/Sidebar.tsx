"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, TrendingUp, ChevronsLeft, ChevronsRight, Wallet } from "lucide-react";
import { ConnectButton } from "@rainbow-me/rainbowkit";

import { useSidebar } from "./SidebarContext";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { href: "/", label: "Feed", icon: Home },
  { href: "/themes", label: "Explore", icon: Compass },
  { href: "/trending", label: "Trending", icon: TrendingUp },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}>
      <Link href="/" className={styles.logo}>
        <span className={styles.logoMark}>DM</span>
        {!collapsed && <span className={styles.logoText}>Debate Market</span>}
      </Link>

      <nav className={styles.nav}>
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`${styles.navLink} ${isActive(href) ? styles.navLinkActive : ""}`}
            title={collapsed ? label : undefined}
          >
            <Icon className={styles.navIcon} />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}
      </nav>

      <div className={styles.spacer} />

      <button
        className={styles.toggleBtn}
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
      </button>

      {!collapsed && (
        <div className={styles.footer}>
          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
              const connected = mounted && account && chain;

              if (!connected) {
                return (
                  <button
                    type="button"
                    onClick={openConnectModal}
                    className={styles.connectBtn}
                  >
                    <Wallet size={14} />
                    <span>Connect wallet</span>
                  </button>
                );
              }

              return (
                <button
                  type="button"
                  onClick={openAccountModal}
                  className={`${styles.connectBtn} ${styles.connectBtnActive}`}
                >
                  <Wallet size={14} />
                  <span className={styles.connectBtnLabel}>
                    {account.displayName}
                  </span>
                </button>
              );
            }}
          </ConnectButton.Custom>
        </div>
      )}
    </aside>
  );
}
