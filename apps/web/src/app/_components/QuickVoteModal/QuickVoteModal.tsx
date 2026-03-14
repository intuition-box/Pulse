"use client";

import { Dialog } from "@/components/Dialog/Dialog";
import { ConnectedConfidenceSlider } from "@/components/ConfidenceSlider/ConnectedConfidenceSlider";

import styles from "./QuickVoteModal.module.css";

type QuickVoteModalProps = {
  tripleTermId: string;
  onClose: () => void;
};

export function QuickVoteModal({ tripleTermId, onClose }: QuickVoteModalProps) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      position="center"
      width={340}
      ariaLabel="Vote"
    >
      <div className={styles.body}>
        <ConnectedConfidenceSlider tripleTermId={tripleTermId} />
      </div>
    </Dialog>
  );
}
