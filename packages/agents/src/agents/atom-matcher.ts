import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { AtomCandidate, AtomMatch } from "../search/types.js";

const AtomMatchSchema = z.object({
  rationale: z.string().min(1),
  choice: z.enum(["existing", "new"]),
  termId: z.string().nullable(),
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const ATOM_MATCHER_SYSTEM = `
You are an atom matcher for a knowledge graph. Given a raw label from a claim, a list of existing atom candidates from the on-chain database, and the claim context, decide whether the raw label matches an existing atom or should create a new one.

Return ONLY JSON:
{ "rationale": "...", "choice": "existing"|"new", "termId": "..."|null, "label": "...", "confidence": 0.0-1.0 }

RULES:
1. REUSE existing atoms when they represent the same concept, even with minor wording differences.
2. "AI" and "Artificial Intelligence" = SAME concept → reuse.
3. "jobs" and "employment" = SAME concept → reuse.
4. "Nuclear energy" and "Nuclear power" = SAME concept → reuse.
5. But "Nuclear energy" and "Solar energy" = DIFFERENT → new.
6. Consider the POSITION (subject/predicate/object) and CLAIM CONTEXT for disambiguation.
7. PREDICATE MATCHING: Only match if the verb/relation has the same meaning AND preserves all structural markers. A predicate with comparative (better...than), conditional (only when/if), negation (not/never/n't), or modal (should/must/will) is ALWAYS different from a candidate missing that structure.
   - "increases" ≈ "raises" but ≠ "decreases"
   - "works only when" ≠ "works"
   - "does not cause" ≠ "causes"
   - "will create" ≠ "creates"
   - "is a better store of value than" ≠ "Store of Value"
8. If choice="existing", set termId to the matching candidate's termId and label to its label.
9. If choice="new", set termId to null and label to the raw label (cleaned up if needed).
10. confidence: 0.9+ for clear matches, 0.5-0.8 for reasonable matches, <0.5 for uncertain.
11. PARTIAL MATCHES: Only match if concepts are truly equivalent, NEVER if one is a subset or adjective of the other. "most creative jobs" vs "Creative" = DIFFERENT. "renewable energy" vs "energy" = DIFFERENT. "job market" vs "jobs" = DIFFERENT. When in doubt, choose "new".
12. DISAMBIGUATION: Use claim context + position. "Apple" in "Apple released iPhone" = company. "apple" in "An apple a day" = fruit.
13. TENSE: Same verb, same auxiliary structure = SAME ("increases" = "increased"). But different auxiliaries = DIFFERENT: "will create" ≠ "create" ≠ "CREATE". The auxiliary (will/can/may/should) changes meaning — preserve it.
14. EXACT MATCH: If a candidate label is exactly equal (case-insensitive) to the raw label, you MUST choose "existing".
15. LABELS ONLY: Never emit hex IDs (0x...) as user-facing labels. Always use human-readable text.
16. POPULARITY TIE-BREAK: When multiple candidates are equally valid semantic matches, prefer the one with more holders and higher marketCap (more established in the network).
17. CONSERVATIVE DEFAULT: If unsure whether two labels are equivalent, choose "new". Creating a new atom is safer than incorrectly reusing one.

EXAMPLES:

rawLabel: "AI", position: "subject", candidates: [{ termId: "0x123", label: "Artificial Intelligence" }]
=> { "rationale": "AI is abbreviation for Artificial Intelligence", "choice": "existing", "termId": "0x123", "label": "Artificial Intelligence", "confidence": 0.95 }

rawLabel: "renewable energy", position: "subject", candidates: [{ termId: "0x456", label: "energy" }]
=> { "rationale": "renewable energy is more specific than energy — different concept", "choice": "new", "termId": null, "label": "renewable energy", "confidence": 0.8 }

rawLabel: "most creative jobs", position: "object", candidates: [{ termId: "0x111", label: "Creative" }]
=> { "rationale": "Creative is an adjective/concept, most creative jobs is a specific noun phrase — different", "choice": "new", "termId": null, "label": "most creative jobs", "confidence": 0.85 }

rawLabel: "will create", position: "predicate", candidates: [{ termId: "0x222", label: "CREATE" }]
=> { "rationale": "will create has future auxiliary, CREATE is bare verb — different meaning", "choice": "new", "termId": null, "label": "will create", "confidence": 0.8 }

rawLabel: "increases", position: "predicate", candidates: [{ termId: "0x789", label: "reduces" }, { termId: "0xabc", label: "raises" }]
=> { "rationale": "raises is semantically equivalent; reduces is opposite", "choice": "existing", "termId": "0xabc", "label": "raises", "confidence": 0.9 }

rawLabel: "is a better store of value than", position: "predicate", candidates: [{ termId: "0x333", label: "Store of Value" }]
=> { "rationale": "Comparative verb phrase (is...than) vs bare noun phrase — structural mismatch", "choice": "new", "termId": null, "label": "is a better store of value than", "confidence": 0.9 }
`;

export async function runAtomMatcher(
  model: LanguageModel,
  rawLabel: string,
  claimContext: string,
  candidates: AtomCandidate[],
  position: AtomMatch["position"],
): Promise<AtomMatch> {
  const prompt = JSON.stringify({
    rawLabel,
    position,
    claimContext,
    candidates: candidates.map((c) => ({
      termId: c.termId,
      label: c.label,
      marketCap: c.marketCap,
      holders: c.holders,
    })),
  }, null, 2);

  const { object } = await generateObject({
    model,
    schema: AtomMatchSchema,
    system: ATOM_MATCHER_SYSTEM,
    prompt,
    providerOptions: { groq: { structuredOutputs: true } },
  });

  return {
    position,
    rawLabel,
    choice: object.choice,
    termId: object.choice === "existing" ? object.termId : null,
    label: object.label,
    confidence: object.confidence,
    rationale: object.rationale,
  };
}
