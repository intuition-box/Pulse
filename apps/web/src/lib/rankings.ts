export type RankingConfig = {
  slug: string;
  label: string;
  predicateTermId: string;
  objectTermId: string;
  themeSlug: string;
  themeAtomTermId: string | null;
};

const IS_THE_BEST = "0x85627132c7f8c72197b10ca2ea5884cd2f6d2cfa50a13740602d3d58b0a60cc8";
const SOCIAL_MEDIA_ATOM = "0x61001780bbeadd1fae3a434e7eb37de7deeea3329187bf4e2058b0c33369ccc4";

export const RANKINGS: RankingConfig[] = [
  { slug: "social-media", label: "Social Media", predicateTermId: IS_THE_BEST, objectTermId: SOCIAL_MEDIA_ATOM, themeSlug: "social-media", themeAtomTermId: SOCIAL_MEDIA_ATOM },
  { slug: "ai", label: "AI", predicateTermId: IS_THE_BEST, objectTermId: "TODO", themeSlug: "technology", themeAtomTermId: null },
  { slug: "car", label: "Car", predicateTermId: IS_THE_BEST, objectTermId: "TODO", themeSlug: "car", themeAtomTermId: null },
  { slug: "breakfast", label: "Breakfast", predicateTermId: IS_THE_BEST, objectTermId: "TODO", themeSlug: "food", themeAtomTermId: null },
];

export const FEATURED_RANKING = RANKINGS[0];
