"use client";

import { useState, useEffect } from "react";

import { Dialog } from "@/components/Dialog/Dialog";
import { Button } from "@/components/Button/Button";
import { Avatar } from "@/components/Avatar/Avatar";
import { TextInput } from "@/components/TextInput/TextInput";
import { DiscordIcon, GitHubIcon } from "@/components/SocialIcons/SocialIcons";
import type {
  UserProfile,
  ConnectedProvider,
  ProfileUpdate,
  SocialProvider,
} from "@/hooks/useUserProfile";

import styles from "./OnboardingDialog.module.css";

function CheckIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

const PROVIDERS: {
  key: SocialProvider;
  label: string;
  icon: (props: { size?: number }) => React.JSX.Element;
  color: string;
}[] = [
  { key: "discord", label: "Discord", icon: DiscordIcon, color: "#5865F2" },
  { key: "github", label: "GitHub", icon: GitHubIcon, color: "#333333" },
];

type OnboardingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: UserProfile;
  connectedProviders: ConnectedProvider[];
  onSave: (data: ProfileUpdate) => Promise<void>;
  onDisconnectSocial: (provider: SocialProvider) => Promise<void>;
  walletDisplayName: string;
};

export function OnboardingDialog({
  open,
  onOpenChange,
  profile,
  connectedProviders,
  onSave,
  onDisconnectSocial,
  walletDisplayName,
}: OnboardingDialogProps) {
  const hasSocials = connectedProviders.length > 0;

  const [nameSource, setNameSource] = useState<string>("wallet");
  const [customName, setCustomName] = useState("");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [bioDirty, setBioDirty] = useState(false);
  const [avatarSource, setAvatarSource] = useState<string>("default");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (connectedProviders.length === 1) {
      setNameSource(connectedProviders[0].provider);
      if (connectedProviders[0].avatar) {
        setAvatarSource(connectedProviders[0].provider);
      }
    }
  }, [connectedProviders]);

  useEffect(() => {
    if (!bioDirty && profile.bio) setBio(profile.bio);
  }, [profile.bio, bioDirty]);

  function getSelectedDisplayName(): string | undefined {
    if (nameSource === "wallet") return undefined;
    if (nameSource === "custom") return customName || undefined;
    const provider = connectedProviders.find((p) => p.provider === nameSource);
    return provider?.name;
  }

  function getSelectedAvatar(): string | null | undefined {
    if (avatarSource === "default") return null;
    const provider = connectedProviders.find(
      (p) => p.provider === avatarSource,
    );
    return provider?.avatar;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const data: ProfileUpdate = { onboardingStep: 1 };
      const displayName = getSelectedDisplayName();
      if (displayName) data.displayName = displayName;
      const avatar = getSelectedAvatar();
      if (avatar !== undefined) data.avatar = avatar;
      if (bio.trim()) data.bio = bio.trim();
      await onSave(data);
    } finally {
      setSaving(false);
    }
  }

  const isCustomNameValid =
    nameSource !== "custom" || (customName.length >= 2 && customName.length <= 30);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Welcome!"
      width={480}
    >
      <div className={styles.content}>
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Connect your accounts</h3>
          <div className={styles.providerList}>
            {PROVIDERS.map(({ key, label, icon: Icon, color }) => {
              const connected = connectedProviders.find(
                (p) => p.provider === key,
              );
              if (connected) {
                return (
                  <div key={key} className={styles.providerConnected}>
                    <span className={styles.providerCheck}>
                      <CheckIcon />
                    </span>
                    <Icon size={16} />
                    <span className={styles.providerName}>
                      {connected.name}
                    </span>
                    <button
                      type="button"
                      className={styles.providerDisconnect}
                      onClick={() => onDisconnectSocial(key)}
                      aria-label={`Disconnect ${label}`}
                    >
                      ×
                    </button>
                  </div>
                );
              }
              return (
                <button
                  type="button"
                  key={key}
                  className={styles.providerBtn}
                  style={{ "--provider-color": color } as React.CSSProperties}
                  onClick={() => window.open(`/api/auth/${key}`, `oauth-${key}`, "width=500,height=700,popup=yes")}
                >
                  <Icon size={16} />
                  <span>Connect {label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {hasSocials && (
          <>
            <div className={styles.divider} />

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Choose your display name</h3>
              <div className={styles.radioGroup}>
                {connectedProviders.map((p) => (
                  <label key={p.provider} className={styles.radioLabel}>
                    <input
                      type="radio"
                      name="nameSource"
                      value={p.provider}
                      checked={nameSource === p.provider}
                      onChange={() => setNameSource(p.provider)}
                      className={styles.radioInput}
                    />
                    <span className={styles.radioText}>
                      {p.name}
                      <span className={styles.radioHint}>
                        ({PROVIDERS.find((pr) => pr.key === p.provider)?.label})
                      </span>
                    </span>
                  </label>
                ))}
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="nameSource"
                    value="wallet"
                    checked={nameSource === "wallet"}
                    onChange={() => setNameSource("wallet")}
                    className={styles.radioInput}
                  />
                  <span className={styles.radioText}>
                    {walletDisplayName}
                    <span className={styles.radioHint}>(Wallet)</span>
                  </span>
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="nameSource"
                    value="custom"
                    checked={nameSource === "custom"}
                    onChange={() => setNameSource("custom")}
                    className={styles.radioInput}
                  />
                  <span className={styles.radioText}>Custom:</span>
                  {nameSource === "custom" && (
                    <TextInput
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Your name"
                      maxLength={30}
                      className={styles.customNameInput}
                      autoFocus
                    />
                  )}
                </label>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Choose your avatar</h3>
              <div className={styles.avatarGrid}>
                {connectedProviders
                  .filter((p) => p.avatar)
                  .map((p) => (
                    <button
                      key={p.provider}
                      type="button"
                      className={`${styles.avatarOption} ${avatarSource === p.provider ? styles.avatarSelected : ""}`}
                      onClick={() => setAvatarSource(p.provider)}
                    >
                      <Avatar
                        src={p.avatar}
                        name={p.name}
                        size="lg"
                      />
                      <span className={styles.avatarLabel}>
                        {PROVIDERS.find((pr) => pr.key === p.provider)?.label}
                      </span>
                    </button>
                  ))}
                <button
                  type="button"
                  className={`${styles.avatarOption} ${avatarSource === "default" ? styles.avatarSelected : ""}`}
                  onClick={() => setAvatarSource("default")}
                >
                  <Avatar
                    src={null}
                    name={walletDisplayName}
                    size="lg"
                  />
                  <span className={styles.avatarLabel}>Default</span>
                </button>
              </div>
            </section>
          </>
        )}

        {hasSocials && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Short bio (optional)</h3>
            <textarea
              className={styles.bioInput}
              value={bio}
              onChange={(e) => {
                setBio(e.target.value);
                setBioDirty(true);
              }}
              placeholder="Tell us about yourself..."
              maxLength={160}
              rows={2}
            />
            <span className={styles.charCount}>{bio.length}/160</span>
          </section>
        )}

        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Skip
          </Button>
          {hasSocials && (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !isCustomNameValid}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
