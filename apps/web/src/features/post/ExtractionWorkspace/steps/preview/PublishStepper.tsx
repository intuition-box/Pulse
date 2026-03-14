import type { PublishStep } from "../../hooks/useOnchainPublish";
import styles from "./publishStepper.module.css";

const STEPS: { key: PublishStep; label: string }[] = [
  { key: "preparing", label: "Preparing publication" },
  { key: "terms", label: "Creating terms" },
  { key: "claims", label: "Creating claims" },
  { key: "linking", label: "Linking to debate" },
  { key: "finalizing", label: "Saving" },
];

function getStatus(stepKey: PublishStep, activeStep: PublishStep): "done" | "active" | "pending" {
  const activeIdx = STEPS.findIndex((s) => s.key === activeStep);
  const stepIdx = STEPS.findIndex((s) => s.key === stepKey);
  if (stepIdx < activeIdx) return "done";
  if (stepIdx === activeIdx) return "active";
  return "pending";
}

type PublishStepperProps = {
  step: PublishStep;
};

export function PublishStepper({ step }: PublishStepperProps) {
  return (
    <ol className={styles.stepper}>
      {STEPS.map(({ key, label }) => {
        const status = getStatus(key, step);
        return (
          <li key={key} className={styles.step} data-status={status}>
            <span className={styles.icon}>
              {status === "done" ? "\u2713" : null}
            </span>
            <span className={styles.label}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
