"use client";

// Inline reply composer rendered after a feed card. Wraps ComposerBlock with
// auto-open behavior + theme selection state for a single ReplyTarget.

import { useEffect, useState } from "react";

import type { ReplyTarget } from "@/app/_components/DebateThread/DebateThread";
import { ComposerBlock } from "@/features/post/ExtractionWorkspace/ComposerBlock";
import { useComposerFlow } from "@/features/post/ExtractionWorkspace/hooks/useComposerFlow";
import { ThemeRow } from "@/components/ThemeSelector/ThemeRow";
import { labels } from "@/lib/vocabulary";

type InlineComposerProps = {
  target: ReplyTarget;
  onClose: () => void;
  onPublishSuccess: (postId: string) => void;
  onCreateTheme: (name: string) => Promise<{ slug: string; name: string } | null>;
};

const PLACEHOLDERS: Record<ReplyTarget["stance"] | "neutral", string> = {
  SUPPORTS: "Back this up…",
  REFUTES: "Push back…",
  neutral: "Add your angle…",
};

export function InlineComposer({ target, onClose, onPublishSuccess, onCreateTheme }: InlineComposerProps) {
  const [selectedThemes, setSelectedThemes] = useState(target.themes);
  const composerFlow = useComposerFlow({
    themes: selectedThemes,
    parentPostId: target.postId,
    parentMainTripleTermId: target.mainTripleTermId,
    onPublishSuccess,
    autoOpen: true,
    onClose,
  });
  const setStance = composerFlow.flow.setStance;

  useEffect(() => {
    setStance(target.stance);
  }, [target.stance, setStance]);

  const placeholder = PLACEHOLDERS[target.stance] ?? PLACEHOLDERS.neutral;

  return (
    <ComposerBlock
      composerFlow={composerFlow}
      hideHeader
      placeholder={placeholder}
      themeSlot={
        <ThemeRow
          selected={selectedThemes}
          onChange={setSelectedThemes}
          min={1}
          onCreateTheme={onCreateTheme}
        />
      }
      extraDisabled={selectedThemes.length === 0}
      extraDisabledHint={selectedThemes.length === 0 ? labels.selectAtLeastOneTheme : undefined}
    />
  );
}
