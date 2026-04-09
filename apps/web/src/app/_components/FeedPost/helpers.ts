export function truncate(text: string, maxLen: number) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "\u2026";
}

export function formatPostDate(isoDate: string) {
  const d = new Date(isoDate);
  const month = d.toLocaleString("en", { month: "short" });
  return `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
