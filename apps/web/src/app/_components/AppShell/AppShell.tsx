"use client";

import { SidebarProvider, useSidebar } from "../Sidebar/SidebarContext";
import { Sidebar } from "../Sidebar/Sidebar";
import { BottomNav } from "../BottomNav/BottomNav";

import styles from "./AppShell.module.css";

function ShellInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  const sidebarClasses = [
    styles.sidebar,
    collapsed ? styles.sidebarCollapsed : "",
  ].filter(Boolean).join(" ");

  const contentClasses = [
    styles.content,
    collapsed ? styles.contentCollapsed : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <div className={sidebarClasses}>
        <Sidebar />
      </div>
      <div className={contentClasses}>
        <div className={styles.mainColumn}>
          <main className={styles.main}>{children}</main>
        </div>
        <div className={styles.bottomNav}>
          <BottomNav />
        </div>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <ShellInner>{children}</ShellInner>
    </SidebarProvider>
  );
}
