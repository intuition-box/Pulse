"use client";

import { PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAccount, useWalletClient, WagmiProvider } from "wagmi";

import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import * as Tooltip from "@radix-ui/react-tooltip";

import { intuitionTestnet } from "@/lib/chain";
import { ToastProvider } from "@/components/Toast/ToastContext";
import { useSessionAuth } from "@/features/post/ExtractionWorkspace/hooks/useSessionAuth";

const config = getDefaultConfig({
  appName: "Debate Market",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  chains: [intuitionTestnet],
  // Avoid server-side WalletConnect storage access (indexedDB is browser-only).
  ssr: false,
});

function SiweOnConnect() {
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const attemptedRef = useRef<string | null>(null);
  const setMessage = useCallback((_msg: string | null) => {}, []);
  const { ensureSession } = useSessionAuth({ setMessage });

  useEffect(() => {
    if (!isConnected || !address || !walletClient) {
      attemptedRef.current = null;
      return;
    }
    const normalized = address.toLowerCase();
    if (attemptedRef.current === normalized) {
      return;
    }
    attemptedRef.current = normalized;
    void ensureSession();
  }, [isConnected, address, walletClient, ensureSession]);

  return null;
}

export function Providers({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <SiweOnConnect />
          <Tooltip.Provider delayDuration={300}>
            <ToastProvider>{children}</ToastProvider>
          </Tooltip.Provider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
