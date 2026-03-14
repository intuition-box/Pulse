import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";


export const GraphOutSchema = z.object({
  core: z.object({
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
  }),
  modifiers: z
    .array(
      z.object({
        prep: z.string().min(1),
        value: z.string().min(1),
      }),
    ),
});

export type GraphOut = z.infer<typeof GraphOutSchema>;

const GRAPH_SYSTEM = `
Extract ONE core semantic triple + prepositional modifiers from a claim.

Return ONLY JSON. No markdown. No code fences. No explanations.

Input JSON:
{ "claim": "...", "sentence_context": "..." }

Output EXACTLY:
{ "core": { "subject":"...", "predicate":"...", "object":"..." }, "modifiers": [...] }

RULE PRIORITY (when rules conflict):
1. Faithfulness — preserve the original meaning, tense, modality, and negation exactly.
2. Reusability — prefer short, reusable atoms (subject/object).
3. Fluency — natural English phrasing in the predicate.
Never sacrifice meaning for shorter atoms.

CORE TRIPLE:
- Keep subject/predicate/object MINIMAL. Strip prepositional phrases into modifiers.
- Subject = grammatical subject (may include more than a word like "Carbon emissions").
- Predicate = main verb/copula + modals (should/must/can/will) + negation (not/never).
  Include adjective complements in the predicate when the verb requires them:
  "makes X worse" => predicate "makes worse", object "X".
- Object = direct complement only. No trailing "by X", "for X", "in X", etc.
  Adverbs that are part of the verbal phrase stay in the object:
  "drives capital offshore" => object "capital offshore".
- When a preposition is essential to the verb's meaning (hide X about Y, spread lies about Y,
  invest in Y, rely on Y, profit from Y, spy on Y, worry about Y, belong on/in/to Z,
  depend on Z, result in Z, lead to Z, focus on Z), fold "verb + prep" into the predicate
  so the object is a reusable atom. Only split into a modifier when the prep phrase is truly
  optional context (time, place, quantity).
- NEVER duplicate: if a prep is folded into the predicate, do NOT also emit it as a modifier.
- Do NOT output a bare preposition as predicate (for/in/of/to/by/with).

ATOM REUSABILITY:
- STRICT: subject and object MUST be 1-4 words. If 5+ words, ALWAYS split the
  prepositional phrase into a modifier. Exception: proper nouns and fixed terms
  that cannot be decomposed (e.g. "United States of America", "freedom of speech").
  Exception: quantified "of" (millions of, thousands of, most of, some of, dozens of)
  and attributive "of" (quality of life, cost of living, burden of proof) stay as one atom.
- If subject or object contains a preposition (of/for/in/to/from/with/about/on/by/through),
  extract the prepositional phrase as a modifier and keep only the head noun phrase.
- Prefer common nouns/noun phrases that others would independently use as atoms.

DENOMINALIZATION:
- If the subject is a nominalization (The impact/effect/influence/role/growth/decline/
  failure/adoption/increase/lack/rise/cost of X), extract X as subject and fold the
  nominalization into an active predicate.
- Preserve tense/modality/negation from the original: "will be positive" -> "will positively impact"
  (keep "will"), "has not reduced" -> keep "has not".
- Avoid copula + vague adjective (is/will be + positive/negative/important/significant)
  ONLY when the sentence is a nominalization. Keep copula when it is structurally
  informative: comparatives (is safer than), classification (is a type of), identity (is the capital of).
- IMPORTANT: Denominalization may restructure the predicate, but subject and object
  must still use words from the input text. Do NOT invent new entities or causes.

COMPARATIVES (than / as...as):
- "X is ADJ-er than Y" -> predicate includes "is ADJ-er than", object is Y.
- "X is more ADJ than Y" -> predicate includes "is more ADJ than", object is Y.
- "X is as ADJ as Y" -> predicate includes "is as ADJ as", object is Y.
- NEVER strip "than" or comparative "as" into a modifier.

PRONOUN RESOLUTION:
- Use sentence_context ONLY to resolve an obvious leading pronoun subject (It/This/They/These/Those).
- Do NOT rewrite other words.

FAITHFULNESS:
- Subject and object must use words present in the claim text.
- Do NOT synthesize, invent, or add words not in the input (no "effective", "valid", "logically").
- Every triple MUST have a non-empty subject, predicate, AND object.
- For intransitive verbs ("X works", "Y breaks down"), use whatever content follows the verb
  as the object. If nothing follows, try to find a meaningful complement from context.
  Do NOT invent a fake object like "(in scale)" or "(in general)".
- If any content follows the verb (clause, adverb, prepositional phrase), it IS the object or modifier.
  Do not ignore it.

WEAK OBJECTS — NEVER use these as the object:
- "it", "this", "that", "things", "something", "everything", "them", "people"
- If the grammatical object is a pronoun, resolve it from context or use the verb's complement.

RELATIVE CLAUSES / PROPOSITIONS IN OBJECT:
- When the object contains a relative clause (who/which/that + verb), ALWAYS split:
  keep only the head noun as object, and extract the relative clause as a modifier.
  "citizens who are educated" → object "citizens", modifier { "prep": "who are", "value": "educated" }
  "policies that reduce emissions" → object "policies", modifier { "prep": "that reduce", "value": "emissions" }
  "a system which rewards innovation" → object "a system", modifier { "prep": "which rewards", "value": "innovation" }
- This rule applies ONLY to relative clause markers (who, which, that + verb).
  Other prepositions (in, for, with, by) follow normal modifier rules.

ATTRIBUTION HINT:
- When the input contains a reporting verb (say, report, argue, claim, believe, etc.),
  PREFER extracting the inner proposition as the core triple.
  "Scientists say air pollution is harmful" → subject "air pollution", predicate "is", object "harmful"
  The pipeline handles attribution separately. But if you include the source, that's OK too.
- Object should be a concept, not a full clause with its own subject-verb-object.

MODIFIERS:
- Each modifier = { "prep": "<preposition>", "value": "<complement>" }
- Common preps: about, by, for, in, of, since, within, to, from, at, as, with, on, through, over, against
- Infinitive clauses after the core ("to be X", "to V X") are modifiers too.
  Use the infinitive verb phrase as prep (e.g. "to be", "to implement", "to achieve").
  This applies to purpose ("in order to"), consequence ("too X to Y", "enough to Y"),
  and any trailing infinitive that adds meaning beyond the core triple.
  For consequence patterns, the prep MUST include the degree word + infinitive verb:
  "enough to destabilize" (NOT "enough to"), "too much to be" (NOT "too much to").
  The value is the verb's complement only (a reusable atom, not a verb phrase).
- Modifier values follow the same atom reusability rules as subject/object (1-4 words).
  If a value contains a preposition, split into separate modifiers.
- Only extract modifiers EXPLICIT in the claim. Do not invent.
- If no modifiers, output empty array.

NOISY INPUT: Claims may contain slang, typos, abbreviations, or informal English. Normalize to clean English triples. "gonna" => "will", "aint" => "is not", etc.

EXAMPLES (grouped by pattern family):

--- BASIC (simple S-P-O + modifiers) ---

Claim: "Ultra-processed foods increase cancer risk by 30%."
=> { "core": { "subject": "Ultra-processed foods", "predicate": "increase", "object": "cancer risk" },
     "modifiers": [{ "prep": "by", "value": "30%" }] }

Claim: "Public trust depends on transparency in scientific research."
=> { "core": { "subject": "Public trust", "predicate": "depends on", "object": "transparency" },
     "modifiers": [{ "prep": "in", "value": "scientific research" }] }

--- COMPARISON (than / as...as — keep full comparative in predicate) ---

Claim: "Nuclear energy is safer than coal."
=> { "core": { "subject": "Nuclear energy", "predicate": "is safer than", "object": "coal" },
     "modifiers": [] }

Claim: "Bitcoin is a better store of value than gold."
=> { "core": { "subject": "Bitcoin", "predicate": "is a better store of value than", "object": "gold" },
     "modifiers": [] }

--- CAUSALITY (cause-effect with modifiers) ---

Claim: "Rent control makes housing shortages worse."
=> { "core": { "subject": "Rent control", "predicate": "makes worse", "object": "housing shortages" },
     "modifiers": [] }

Claim: "Climate change poses a significant threat to global food security."
=> { "core": { "subject": "Climate change", "predicate": "poses", "object": "a significant threat" },
     "modifiers": [{ "prep": "to", "value": "global food security" }] }

--- NEGATION (preserve not/never/doesn't in predicate) ---

Claim: "Free speech doesn't mean freedom from consequences."
=> { "core": { "subject": "Free speech", "predicate": "doesn't mean", "object": "freedom" },
     "modifiers": [{ "prep": "from", "value": "consequences" }] }

--- MODALITY (preserve should/must/will/can in predicate) ---

Claim: "AI will replace most jobs within the next 10 years."
=> { "core": { "subject": "AI", "predicate": "will replace", "object": "most jobs" },
     "modifiers": [{ "prep": "within", "value": "the next 10 years" }] }

Claim: "The minimum wage should be raised to 20 dollars per hour."
=> { "core": { "subject": "The minimum wage", "predicate": "should be", "object": "raised" },
     "modifiers": [{ "prep": "to", "value": "20 dollars per hour" }] }

--- NOMINALIZATION (unfold "The X of Y" into active predicate) ---

Claim: "The impact of AI in the creative sector will be positive."
=> { "core": { "subject": "AI", "predicate": "will positively impact", "object": "the creative sector" },
     "modifiers": [] }

Claim: "The influence of social media on teenagers is harmful."
=> { "core": { "subject": "Social media", "predicate": "harms", "object": "teenagers" },
     "modifiers": [] }

--- RELATIVE CLAUSE (split proposition out of object into modifier) ---

Claim: "AI should regulate citizens who are educated."
=> { "core": { "subject": "AI", "predicate": "should regulate", "object": "citizens" },
     "modifiers": [{ "prep": "who are", "value": "educated" }] }

Claim: "We need policies that reduce carbon emissions."
=> { "core": { "subject": "We", "predicate": "need", "object": "policies" },
     "modifiers": [{ "prep": "that reduce", "value": "carbon emissions" }] }

--- CONSEQUENCE (degree + infinitive verb in prep, direct object stays in core) ---

Claim: "Social media amplifies misinformation fast enough to undermine democratic elections."
=> { "core": { "subject": "Social media", "predicate": "amplifies", "object": "misinformation" },
     "modifiers": [{ "prep": "fast enough to undermine", "value": "democratic elections" }] }

--- NOISY INPUT ---

Claim: "ai is gonna take our jobs lol"
=> { "core": { "subject": "AI", "predicate": "will take", "object": "jobs" },
     "modifiers": [] }
`;

export async function runGraphExtraction(model: LanguageModel, prompt: string) {
  const { object } = await generateObject({
    model,
    schema: GraphOutSchema,
    system: GRAPH_SYSTEM,
    prompt,
    providerOptions: { groq: { structuredOutputs: true } },
  });
  return object;
}
