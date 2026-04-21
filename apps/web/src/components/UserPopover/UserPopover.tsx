"use client";

import { useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";

import { Avatar } from "@/components/Avatar/Avatar";
import { SOCIAL_ICONS } from "@/components/SocialIcons/SocialIcons";

import styles from "./UserPopover.module.css";

type UserSummary = {
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  address: string;
  discord: string | null;
  github: string | null;
  postCount: number;
  totalSupportsReceived: number;
};

async function fetchUserSummary(address: string): Promise<UserSummary> {
  const res = await fetch(`/api/user/${address}/summary`);
  if (!res.ok) throw new Error("Failed to fetch user summary");
  return res.json();
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

type UserPopoverProps = {
  address: string;
  children: ReactNode;
};

export function UserPopover({ address, children }: UserPopoverProps) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["user-summary", address],
    queryFn: () => fetchUserSummary(address),
    enabled: open,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const socials = data
    ? (["discord", "github"] as const).filter((k) => data[k])
    : [];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.content}
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {isLoading || !data ? (
            <div className={styles.skeleton}>
              <div className={styles.skeletonLine} style={{ width: "60%" }} />
              <div className={styles.skeletonLine} style={{ width: "40%" }} />
              <div className={styles.skeletonLine} style={{ width: "80%" }} />
            </div>
          ) : (
            <>
              <div className={styles.identity}>
                <Avatar
                  src={data.avatar}
                  name={data.displayName || truncateAddress(data.address)}
                  size="md"
                />
                <div className={styles.names}>
                  <span className={styles.displayName}>
                    {data.displayName || truncateAddress(data.address)}
                  </span>
                  <span className={styles.address}>
                    {truncateAddress(data.address)}
                  </span>
                </div>
              </div>

              {data.bio && <p className={styles.bio}>{data.bio}</p>}

              <div className={styles.stats}>
                {data.postCount} posts · {data.totalSupportsReceived} supports
              </div>

              {socials.length > 0 && (
                <div className={styles.socials}>
                  {socials.map((key) => {
                    const Icon = SOCIAL_ICONS[key];
                    return <Icon key={key} />;
                  })}
                </div>
              )}
            </>
          )}
          <Popover.Arrow className={styles.arrow} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
