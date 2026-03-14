import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";


export const RelationSchema = z.object({
  relations: z
    .array(
      z.object({
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
        predicate: z.string().min(1),
      })
    ),
});

const RELATION_SYSTEM = `
You are a sentence-level relation linker.

Your job is NOT to judge truth or stance.
Your job is to recover explicit discourse/logic relations inside the sentence so they can become NESTED TRIPLES on-chain.

Return ONLY JSON. No markdown. No code fences. No explanations.

INPUT JSON:
{
  "sentence": "...",
  "claims": [
    { "index": 0, "text": "...", "core_triple": "(S | P | O)" },
    ...
  ]
}

OUTPUT JSON:
{ "relations": [ { "from": 0, "to": 1, "predicate": "because" }, ... ] }

ALLOWED PREDICATES (use exactly these strings):
- "but"
- "however"
- "although"
- "because"
- "therefore"
- "so"
- "if"
- "unless"
- "when"
- "could lead to"
- "may lead to"
- "might lead to"
- "will lead to"

CRITICAL CONSTRAINTS:
1) Only output a relation if there is an EXPLICIT marker in the original sentence.
   Markers include: but/however/although/yet, because, therefore/so, if/unless/when,
   and which-clauses of the form ", which could/may/might/will ...".
2) Never invent support/refute (stance belongs elsewhere).
3) Never output predicates outside the allowed list.
4) Prefer linking adjacent claims (index i to i+1) unless a marker clearly links non-adjacent.
5) No self-links.
6) If uncertain, output no relation.
7) Do NOT link claims that are simply conjoined by "and" or "or" — these are not logical discourse relations.

MARKER NORMALIZATION:
- "yet" in sentence => use predicate "but" (contrast)
- "though" in sentence => use predicate "although" (concession)
- "since" (causal sense) => use predicate "because"
- "hence"/"thus" => use predicate "therefore"

DIRECTION RULES:
- Contrast: "A but B" => link (A) --but--> (B)
  (Follow textual order: first clause contrasted by second clause.)
- Cause: "A because B" => link (A) --because--> (B)        [effect -> cause]
- Therefore/so: "A, therefore B" => link (B) --therefore--> (A) [conclusion -> premise]
- Condition:
  "If C, A"    => link (A) --if--> (C)
  "A if C"     => link (A) --if--> (C)
  "A unless C" => link (A) --unless--> (C)
  "A when C"   => link (A) --when--> (C)
- Which-clause consequence:
  "A, which could/may/might/will B" => link (A) --(modal lead to)--> (B)

Return 0-6 relations maximum.

FULL EXAMPLE:

Input:
{
  "sentence": "Nuclear energy reduces CO2, but it produces radioactive waste.",
  "claims": [
    { "index": 0, "text": "Nuclear energy reduces CO2.", "core_triple": "(Nuclear energy | reduces | CO2)" },
    { "index": 1, "text": "Nuclear energy produces radioactive waste.", "core_triple": "(Nuclear energy | produces | radioactive waste)" }
  ]
}
Output: { "relations": [{ "from": 0, "to": 1, "predicate": "but" }] }
`;

export async function runRelationLinking(model: LanguageModel, prompt: string) {
  const { object } = await generateObject({
    model,
    schema: RelationSchema,
    system: RELATION_SYSTEM,
    prompt,
    providerOptions: { groq: { structuredOutputs: true } },
  });
  return object;
}
