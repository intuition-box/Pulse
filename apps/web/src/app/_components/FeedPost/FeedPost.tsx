import { ReplyCard } from "@/app/_components/ReplyCard/ReplyCard";
import type { FeedPostData } from "@/app/HomePageClient";
import type { SentimentMap } from "@/hooks/useSentimentBatch";
import type { ReplyTarget } from "./FeedThread";

type FeedPostProps = {
  post: FeedPostData;
  onBadgeClick?: (tripleTermIds: string[], postId: string) => void;
  onReply?: (target: ReplyTarget) => void;
  sentimentMap?: SentimentMap;
};

export function FeedPost({ post, onBadgeClick, onReply, sentimentMap }: FeedPostProps) {
  const mainTripleTermId = post.mainTripleTermIds?.[0] ?? undefined;
  const sentiment = mainTripleTermId ? sentimentMap?.[mainTripleTermId] ?? null : null;

  return (
    <ReplyCard
      id={post.id}
      body={post.body}
      createdAt={post.createdAt}
      replyCount={post.replyCount}
      author={post.user}
      themeName={post.theme.name}
      variant="compact"
      mainTripleTermId={mainTripleTermId}
      mainTripleTermIds={post.mainTripleTermIds}
      sentimentData={sentiment}
      onBadgeClick={onBadgeClick}
      onReply={onReply ? () => onReply({ postId: post.id, themeSlug: post.theme.slug, mainTripleTermId: mainTripleTermId ?? null }) : undefined}
      showBorder={false}
    />
  );
}
