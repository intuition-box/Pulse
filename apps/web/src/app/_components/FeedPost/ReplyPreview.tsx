import { ReplyCard } from "@/app/_components/ReplyCard/ReplyCard";
import type { FeedReplyPreview } from "@/app/HomePageClient";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import type { ReplyTarget } from "./FeedThread";

type ReplyPreviewProps = {
  reply: FeedReplyPreview;
  themeSlug: string;
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  onReply?: (target: ReplyTarget) => void;
  sentimentMap?: SentimentMap;
};

export function ReplyPreview({ reply, themeSlug, onBadgeClick, onReply, sentimentMap }: ReplyPreviewProps) {
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

      onReply={onReply ? () => onReply({ postId: reply.id, themeSlug, mainTripleTermId }) : undefined}
    />
  );
}
