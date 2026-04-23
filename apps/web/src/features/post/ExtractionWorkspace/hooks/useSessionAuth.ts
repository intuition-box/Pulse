"use client";

import { useEffect, useRef } from "react";
import { useAccount, useWalletClient } from "wagmi";

import { getErrorMessage } from "@/lib/getErrorMessage";

import { intuitionTestnet } from "@/lib/chain";

function generateNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildSiweMessage(params: {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}): string {
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    "",
    params.statement,
    "",
    `URI: ${params.uri}`,
    "Version: 1",
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    `Expiration Time: ${params.expirationTime}`,
  ].join("\n");
}

type UseSessionAuthParams = {
  setMessage: (msg: string | null) => void;
};

export function useSessionAuth({ setMessage }: UseSessionAuthParams) {
  const { isConnected, address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const sessionRef = useRef<{ address: string; chainId: number; timestamp: number } | null>(null);
  const SESSION_TTL = 5 * 60 * 1000; // 5 minutes

  // Invalidate session cache when wallet changes
  useEffect(() => {
    const cached = sessionRef.current;
    if (cached && address && cached.address.toLowerCase() !== address.toLowerCase()) {
      sessionRef.current = null;
    }
  }, [address]);

  async function ensureSession(): Promise<boolean> {
    if (!isConnected || !walletClient) {
      setMessage("Connect your wallet to write.");
      return false;
    }

    if (!address) {
      setMessage("Wallet address is not available yet.");
      return false;
    }

    if (!walletClient.account) {
      setMessage("Wallet is initializing. Please try again.");
      return false;
    }

    const activeChainId = intuitionTestnet.id;

    // If we already established a session for this wallet, skip (within TTL)
    const cached = sessionRef.current;
    if (
      cached &&
      cached.address.toLowerCase() === address.toLowerCase() &&
      cached.chainId === activeChainId &&
      Date.now() - cached.timestamp < SESSION_TTL
    ) {
      return true;
    }

    // Check if a server session cookie already exists
    try {
      const checkRes = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (
          checkData.authenticated &&
          checkData.address?.toLowerCase() === address.toLowerCase()
        ) {
          sessionRef.current = { address, chainId: activeChainId, timestamp: Date.now() };
          return true;
        }
      }
    } catch {
      // Session check failed — proceed to sign
    }

    // No valid session — sign SIWE message (one wallet prompt)
    const now = Date.now();
    const domain = window.location.host;
    const uri = window.location.origin;
    const issuedAt = new Date().toISOString();
    const expirationTime = new Date(now + 10 * 60 * 1000).toISOString();
    const nonce = generateNonce();
    const message = buildSiweMessage({
      domain,
      address,
      statement: "Sign in to write on PULSE.",
      uri,
      chainId: activeChainId,
      nonce,
      issuedAt,
      expirationTime,
    });

    try {
      const signature = await walletClient.signMessage({
        account: walletClient.account,
        message,
      });

      // POST to auth endpoint — server validates and sets cookie
      const authRes = await fetch("/api/auth/siwe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });

      if (!authRes.ok) {
        const err = await authRes.json().catch(() => ({}));
        setMessage(err.error ?? "Authentication failed.");
        return false;
      }

      sessionRef.current = { address, chainId: activeChainId, timestamp: Date.now() };
      return true;
    } catch (error: unknown) {
      setMessage(getErrorMessage(error, "Wallet signature required to write."));
      return false;
    }
  }

  return { ensureSession };
}
