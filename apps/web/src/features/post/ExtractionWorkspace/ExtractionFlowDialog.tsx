"use client";

import { useState } from "react";
import { useConnect } from "wagmi";
import { injected } from "wagmi/connectors";

import { FlowDialog } from "@/app/_components/FlowDialog/FlowDialog";
import { labels } from "@/lib/vocabulary";
import dialogStyles from "@/components/Dialog/Dialog.module.css";

import type { UseExtractionFlowResult } from "./hooks/useExtractionFlow";
import { StepPreviewPublish } from "./steps/StepPreviewPublish";

type Props = {
  flow: UseExtractionFlowResult;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ExtractionFlowDialog({ flow, open, onOpenChange }: Props) {
  const { connect } = useConnect();
  const [chatOpen, setChatOpen] = useState(false);
  const extractionComplete = Boolean(flow.extractionJob && flow.extractionJob.status !== "pending");
  const showChat = chatOpen && extractionComplete && flow.proposalCount > 0;

  return (
    <FlowDialog
      open={open}
      onOpenChange={onOpenChange}
      title={labels.dialogStepPreview}
      helpText={labels.previewIntroBody}
      width={showChat ? 1160 : undefined}
      bodyClassName={dialogStyles.bodyNoScroll}
    >
      <StepPreviewPublish
        flow={flow}
        chatOpen={chatOpen}
        onChatOpenChange={setChatOpen}
        onBack={() => onOpenChange(false)}
        onConnect={() => connect({ connector: injected() })}
      />
    </FlowDialog>
  );
}
