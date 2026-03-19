"use client";

import type { ReactNode } from "react";
import { Composer } from "@/features/post/Composer/Composer";
import { ExtractionFlowDialog } from "./ExtractionFlowDialog";
import type { UseComposerFlowResult } from "./hooks/useComposerFlow";

type Props = {
  composerFlow: UseComposerFlowResult;
  className?: string;
  themeSlot?: ReactNode;
  extraDisabled?: boolean;
  extraDisabledHint?: string;
  hideHeader?: boolean;
  placeholder?: string;
};

export function ComposerBlock({ composerFlow, className, themeSlot, extraDisabled, extraDisabledHint, hideHeader, placeholder }: Props) {
  const {
    flow,
    composerOpen,
    dialogOpen,
    setDialogOpen,
    handleExtract,
    closeComposer,
  } = composerFlow;

  return (
    <>
      {composerOpen && (
        <section className={className}>
          <Composer
            stance={flow.stance}
            inputText={flow.inputText}
            busy={flow.busy}
            walletConnected={flow.walletConnected}
            extracting={flow.isExtracting}
            contextDirty={flow.contextDirty}
            message={flow.message}
            status={flow.extractionJob?.status}
            onInputChange={flow.setInputText}
            onExtract={handleExtract}
            onClose={closeComposer}
            themeSlot={themeSlot}
            extraDisabled={extraDisabled}
            extraDisabledHint={extraDisabledHint}
            hideHeader={hideHeader}
            placeholder={placeholder}
          />
        </section>
      )}
      <ExtractionFlowDialog
        flow={flow}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}
