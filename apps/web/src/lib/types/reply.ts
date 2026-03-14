export type Author = {
  displayName: string | null;
  address: string;
  avatar: string | null;
};

export type ReplyNode = {
  id: string;
  body: string;
  createdAt: string;
  stance: string | null;
  replyCount: number;
  mainTripleTermIds?: string[];
  author?: Author;
};
