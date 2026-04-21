"use client";

import { useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";

export type SocialProvider = "discord" | "github";

export type ConnectedProvider = {
  provider: SocialProvider;
  name: string;
  avatar: string | null;
};

export type UserProfile = {
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  email: string | null;
  onboardingStep: number;
  discord: { name: string; avatar: string | null } | null;
  github: { name: string; avatar: string | null } | null;
};

export type ProfileUpdate = {
  displayName?: string;
  avatar?: string | null;
  bio?: string;
  onboardingStep?: number;
};

async function fetchProfile(): Promise<UserProfile> {
  const res = await fetch("/api/user/profile");
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

async function patchProfile(data: ProfileUpdate): Promise<void> {
  const res = await fetch("/api/user/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update profile");
}

async function deleteSocial(provider: SocialProvider): Promise<void> {
  const res = await fetch(`/api/auth/${provider}/disconnect`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to disconnect ${provider}`);
}

const QUERY_KEY = ["user-profile"];

export function useUserProfile() {
  const { isConnected } = useAccount();
  const queryClient = useQueryClient();

  const { data: profile = null, isLoading } = useQuery<UserProfile | null>({
    queryKey: QUERY_KEY,
    queryFn: fetchProfile,
    enabled: isConnected,
    staleTime: 30_000,
    retry: 1,
  });

  const updateMutation = useMutation({
    mutationFn: patchProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const disconnectMutation = useMutation({
    mutationFn: deleteSocial,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const updateProfile = useCallback(
    (data: ProfileUpdate) => updateMutation.mutateAsync(data),
    [updateMutation],
  );

  const disconnectSocialFn = useCallback(
    (provider: SocialProvider) => disconnectMutation.mutateAsync(provider),
    [disconnectMutation],
  );

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    [queryClient],
  );

  const isOnboarded = (profile?.onboardingStep ?? 0) >= 1;

  const connectedProviders = useMemo<ConnectedProvider[]>(() => {
    if (!profile) return [];
    const providers: ConnectedProvider[] = [];
    if (profile.discord) {
      providers.push({ provider: "discord", ...profile.discord });
    }
    if (profile.github) {
      providers.push({ provider: "github", ...profile.github });
    }
    return providers;
  }, [profile]);

  return {
    profile,
    isLoading,
    updateProfile,
    disconnectSocial: disconnectSocialFn,
    isOnboarded,
    connectedProviders,
    refetch,
  };
}
