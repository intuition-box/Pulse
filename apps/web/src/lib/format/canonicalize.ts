
export function canonicalize(s: string): string {
  return s
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:!?]+$/, "")
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}
