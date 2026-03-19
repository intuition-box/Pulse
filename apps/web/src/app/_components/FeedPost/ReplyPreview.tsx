import { ReplyCard } from "@/app/_components/ReplyCard/ReplyCard";
import type { FeedReplyPreview } from "@/app/HomePageClient";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import type { ReplyTarget } from "./FeedThread";

type ReplyPreviewProps = {
  reply: FeedReplyPreview;
  themeSlug: string;
  themes: { slug: string; name: string }[];
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  onReply?: (target: ReplyTarget) => void;
  activeReplyStance?: "SUPPORTS" | "REFUTES" | null;
  sentimentMap?: SentimentMap;
};

export function ReplyPreview({ reply, themeSlug, themes, onBadgeClick, onReply, activeReplyStance, sentimentMap }: ReplyPreviewProps) {
  const mainTripleTermId = reply.mainTripleTermIds?.[0] ?? null;

  return (
    <ReplyCard
      id={reply.id}
      body={reply.body}
      createdAt={reply.createdAt}
      replyCount={reply.replyCount}
      author={reply.user}
      stance={reply.stance}
      variant="compact"
      mainTripleTermId={mainTripleTermId ?? undefined}
      mainTripleTermIds={reply.mainTripleTermIds}
      sentimentData={mainTripleTermId ? sentimentMap?.[mainTripleTermId] ?? null : null}
      onBadgeClick={onBadgeClick}
      onReply={onReply ? (stance) => onReply({ postId: reply.id, themeSlug, themes, mainTripleTermId, stance }) : undefined}
      activeReplyStance={activeReplyStance}
    />
  );
}
