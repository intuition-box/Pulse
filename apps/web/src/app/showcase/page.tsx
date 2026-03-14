"use client";

import { useState } from "react";

import { Badge } from "@/components/Badge/Badge";
import { Button } from "@/components/Button/Button";
import { ProtocolBadge } from "@/components/ProtocolBadge/ProtocolBadge";
import { Card } from "@/components/Card/Card";
import { Composer } from "@/features/post/Composer/Composer";
import { ReplyColumn } from "@/app/_components/ReplyColumn/ReplyColumn";
import { RightPanel } from "@/app/_components/RightPanel/RightPanel";
import { Sheet } from "@/app/_components/Sheet/Sheet";
import { TextInput } from "@/components/TextInput/TextInput";
import { TextArea } from "@/components/TextArea/TextArea";

import { ToastItem, type Toast } from "@/components/Toast/Toast";
import { MiniTree } from "@/components/MiniTree/MiniTree";
import { SentimentBar } from "@/components/SentimentBar/SentimentBar";
import { SentimentCircle } from "@/components/SentimentBar/SentimentCircle";
import { ThumbVote } from "@/components/ThumbVote/ThumbVote";

import styles from "./showcase.module.css";

const MOCK_REPLIES = [
  { id: "r1", body: "This is clearly supported by evidence from multiple studies on the topic.", createdAt: "2026-01-15", stance: null, replyCount: 3,
    author: { displayName: "Alice", address: "0x1234567890abcdef1234567890abcdef12345678", avatar: null } },
  { id: "r2", body: "The economic data strongly backs this claim when looking at long-term trends.", createdAt: "2026-01-16", stance: null, replyCount: 1,
    author: { displayName: null, address: "0xabcdef1234567890abcdef1234567890abcdef12", avatar: null } },
];

const MOCK_TOAST_SUCCESS: Toast = { id: "t1", type: "success", message: "Reply published on-chain", action: { label: "View", href: "#" }, duration: 0 };
const MOCK_TOAST_ERROR: Toast = { id: "t2", type: "error", message: "Transaction failed: insufficient funds", duration: 0 };
const MOCK_TOAST_INFO: Toast = { id: "t3", type: "info", message: "Extraction complete — 2 triples found", duration: 0 };

export default function ShowcasePage() {
  const [sheetOpen, setSheetOpen] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [composerText, setComposerText] = useState("AI will eventually surpass human reasoning in all domains.");

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Component Showcase</h1>
      <p className={styles.pageSubtitle}>All MERIDIAN design system components</p>

      {/* ── Badges ─────────────────────────────────────────── */}
      <Section title="Badge">
        <div className={styles.row}>
          <Badge tone="neutral">Neutral</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge tone="supports">Supports</Badge>
          <Badge tone="refutes">Refutes</Badge>
          <ProtocolBadge>Protocol</ProtocolBadge>
        </div>
      </Section>

      {/* ── Buttons ────────────────────────────────────────── */}
      <Section title="Button">
        <div className={styles.row}>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </div>
        <div className={styles.row}>
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="secondary" size="sm">Small</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </div>
      </Section>

      {/* ── Card ───────────────────────────────────────────── */}
      <Section title="Card">
        <div className={styles.grid3}>
          <Card>
            <p style={{ margin: 0 }}>Default padding card with some content inside.</p>
          </Card>
          <Card>
            <p style={{ margin: 0 }}>Second card variant.</p>
          </Card>
          <Card>
            <p style={{ margin: 0 }}>Third card variant.</p>
          </Card>
        </div>
      </Section>

      {/* ── TextInput / TextArea ───────────────────────────── */}
      <Section title="TextInput & TextArea">
        <div className={styles.stack}>
          <TextInput placeholder="Enter a thesis..." />
          <TextInput placeholder="Disabled input" disabled />
          <TextArea placeholder="Write your argument here..." rows={3} />
        </div>
      </Section>

      {/* ── Toasts ─────────────────────────────────────────── */}
      <Section title="Toast">
        <div className={styles.stack}>
          <ToastItem toast={MOCK_TOAST_SUCCESS} onDismiss={() => {}} />
          <ToastItem toast={MOCK_TOAST_ERROR} onDismiss={() => {}} />
          <ToastItem toast={MOCK_TOAST_INFO} onDismiss={() => {}} />
        </div>
      </Section>

      {/* ── Composer ───────────────────────────────────────── */}
      <Section title="Composer">
        <div style={{ maxWidth: 600 }}>
          <Composer
            stance="SUPPORTS"
            inputText={composerText}
            busy={false}
            walletConnected={true}
            extracting={false}
            contextDirty={false}
            message={null}
            status="READY_TO_PUBLISH"
            onInputChange={setComposerText}
            onExtract={() => {}}
            onClose={() => {}}
          />
        </div>
      </Section>

      {/* ── ReplyColumn ────────────────────────────────────── */}
      <Section title="ReplyColumn">
        <div className={styles.grid3}>
          <ReplyColumn
            stance="supports"
            title="Supports"
            replies={MOCK_REPLIES}
            onAdd={() => {}}
          />
          <ReplyColumn
            stance="refutes"
            title="Refutes"
            replies={[]}
            onAdd={() => {}}
          />
        </div>
      </Section>

      {/* ── MiniTree ───────────────────────────────────────── */}
      <Section title="MiniTree">
        <div style={{ maxWidth: 500, margin: "0 auto" }}>
          <MiniTree
            ancestors={[
              { id: "a1", body: "Should we regulate AI development?" },
              { id: "a2", body: "AI regulation could stifle innovation in key sectors." },
            ]}
            focusNode={{ id: "f1", body: "The benefits of regulation outweigh the costs to innovation." }}
            basePath="/posts"
          >
            {[
              { id: "c1", body: "Regulation has worked in pharma", stance: "SUPPORTS" as const },
              { id: "c2", body: "Speed of AI progress makes regulation impractical", stance: "REFUTES" as const },
            ]}
          </MiniTree>
        </div>
      </Section>

      {/* ── ThumbVote ─────────────────────────────────────── */}
      <Section title="ThumbVote">
        <div className={styles.row}>
          <ThumbVote forCount={12} againstCount={5} userDirection={null} onVote={() => {}} busy={false} size="sm" />
          <ThumbVote forCount={8} againstCount={3} userDirection="support" onVote={() => {}} busy={false} size="sm" />
          <ThumbVote forCount={4} againstCount={9} userDirection="oppose" onVote={() => {}} busy={false} size="sm" />
          <ThumbVote forCount={0} againstCount={0} userDirection={null} onVote={() => {}} busy={true} busyDirection="support" size="sm" />
        </div>
        <div className={styles.row}>
          <ThumbVote forCount={42} againstCount={18} userDirection={null} onVote={() => {}} busy={false} size="md" />
          <ThumbVote forCount={42} againstCount={18} userDirection="support" onVote={() => {}} busy={false} size="md" />
        </div>
      </Section>

      {/* ── SentimentBar ────────────────────────────────────── */}
      <Section title="SentimentBar">
        <div className={styles.stack}>
          <SentimentBar supportPct={62} totalParticipants={19} forCount={12} againstCount={7} />
          <SentimentBar supportPct={75} totalParticipants={3} />
          <SentimentBar supportPct={50} totalParticipants={0} />
        </div>
      </Section>

      {/* ── SentimentCircle ────────────────────────────────── */}
      <Section title="SentimentCircle">
        <div className={styles.row}>
          <SentimentCircle supportPct={62} totalParticipants={19} mode="full" />
          <SentimentCircle supportPct={85} totalParticipants={3} mode="full" />
          <SentimentCircle supportPct={50} totalParticipants={0} mode="full" />
          <SentimentCircle supportPct={62} totalParticipants={19} mode="compact" />
          <SentimentCircle supportPct={85} totalParticipants={3} mode="compact" />
          <SentimentCircle supportPct={30} totalParticipants={8} mode="compact" />
          <SentimentCircle supportPct={50} totalParticipants={0} mode="compact" />
        </div>
      </Section>

      {/* ── Overlays ───────────────────────────────────────── */}
      <Section title="Overlays (Sheet, RightPanel)">
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>
            Open Sheet
          </Button>
          <Button variant="secondary" onClick={() => setPanelOpen(!panelOpen)}>
            Toggle RightPanel
          </Button>
        </div>
        {panelOpen && (
          <RightPanel open title="Inspector Panel" onClose={() => setPanelOpen(false)}>
            <p style={{ padding: "1rem", color: "var(--text-secondary)" }}>
              Panel content goes here. Used for protocol inspector and extraction workspace.
            </p>
          </RightPanel>
        )}
      </Section>

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Example Sheet">
        <p style={{ padding: "1rem", color: "var(--text-secondary)" }}>
          Sheet content — slides from right on desktop, bottom sheet on mobile. Uses Radix Dialog for accessibility.
        </p>
      </Sheet>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <div className={styles.sectionContent}>{children}</div>
    </section>
  );
}
