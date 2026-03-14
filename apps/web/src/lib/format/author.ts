import type { Author } from "@/lib/types/reply";

export function authorLabel(author?: Author | null): string {
  if (!author) return "Anonymous";
  return author.displayName || `${author.address.slice(0, 6)}\u2026${author.address.slice(-4)}`;
}
