"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useAccount, useWalletClient } from "wagmi";

import { useUserProfile } from "@/hooks/useUserProfile";
import { OnboardingProvider } from "./OnboardingContext";
import { OnboardingDialog } from "./OnboardingDialog";

export function OnboardingGuard({ children }: { children: ReactNode }) {
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const {
    profile,
    isLoading,
    isOnboarded,
    connectedProviders,
    updateProfile,
    disconnectSocial,
    refetch,
  } = useUserProfile();

  const [manualOpen, setManualOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // OAuth popup-blocked fallback: ?onboarding=refresh means we got redirected
  // back instead of receiving a postMessage. Lazy initializer avoids SSR crash.
  const [fromOauth, setFromOauth] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      new URLSearchParams(window.location.search).get("onboarding") ===
      "refresh"
    );
  });

  useEffect(() => {
    if (!fromOauth) return;
    window.history.replaceState({}, "", window.location.pathname);
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "oauth-success") {
        refetch();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [refetch]);

  const autoOpen =
    isConnected && !!walletClient && !isLoading && !!profile && !isOnboarded;
  const dialogOpen = manualOpen || ((autoOpen || fromOauth) && !dismissed);

  const openEditDialog = useCallback(() => {
    setDismissed(false);
    setManualOpen(true);
  }, []);

  // Prevents the close handler from re-PATCHing after an explicit save.
  const savingRef = useRef(false);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setManualOpen(false);
        setDismissed(true);
        setFromOauth(false);
        if (!isOnboarded && !savingRef.current) {
          void updateProfile({ onboardingStep: 1 });
        }
        savingRef.current = false;
      } else {
        setDismissed(false);
        setManualOpen(true);
      }
    },
    [isOnboarded, updateProfile],
  );

  const handleSave = useCallback(
    async (data: Parameters<typeof updateProfile>[0]) => {
      savingRef.current = true;
      await updateProfile({ ...data, onboardingStep: 1 });
      setManualOpen(false);
      setDismissed(true);
      setFromOauth(false);
    },
    [updateProfile],
  );

  const walletDisplayName = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  return (
    <OnboardingProvider value={{ openEditDialog }}>
      {children}
      {profile && (
        <OnboardingDialog
          open={dialogOpen}
          onOpenChange={handleOpenChange}
          profile={profile}
          connectedProviders={connectedProviders}
          onSave={handleSave}
          onDisconnectSocial={disconnectSocial}
          walletDisplayName={walletDisplayName}
        />
      )}
    </OnboardingProvider>
  );
}
