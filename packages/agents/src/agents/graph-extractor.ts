import { generateObject, jsonSchema } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { RecursiveSlot } from "../helpers/claimPlanner.js";

const LeafTriple = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
});

const AtomOrTriple = z.union([
  z.string().min(1),
  z.object({
    subject: z.union([z.string().min(1), LeafTriple]),
    predicate: z.string().min(1),
    object: z.union([z.string().min(1), LeafTriple]),
  }),
]) as z.ZodType<RecursiveSlot>;

export const GraphOutSchema = z.object({
  core: z.object({
    subject: AtomOrTriple,
    predicate: z.string().min(1),
    object: AtomOrTriple,
  }),
  modifiers: z.array(
    z.object({
      prep: z.string().min(1),
      value: z.string().min(1),
    }),
  ),
});

export type GraphOut = z.infer<typeof GraphOutSchema>;

type JSONSchemaObj = Record<string, any>;

// 4-level explicit nesting (no $ref — Groq expands recursive refs and blows context).
// Level 4 = string only, Level 3 = string | {s,p,o: string}, Level 2 = string | {s,p,o: Level3}, Level 1 = string | {s,p,o: Level2}
const strField = { type: "string", minLength: 1 };
const tripleOf = (slot: JSONSchemaObj): JSONSchemaObj => ({
  type: "object",
  properties: { subject: slot, predicate: strField, object: slot },
  required: ["subject", "predicate", "object"],
  additionalProperties: false,
});

const level3: JSONSchemaObj = { anyOf: [strField, tripleOf(strField)] };
const level2: JSONSchemaObj = { anyOf: [strField, tripleOf(level3)] };
const level1: JSONSchemaObj = { anyOf: [strField, tripleOf(level2)] };

const GRAPH_OUT_JSON_SCHEMA: JSONSchemaObj = {
  type: "object",
  properties: {
    core: {
      type: "object",
      properties: { subject: level1, predicate: strField, object: level1 },
      required: ["subject", "predicate", "object"],
      additionalProperties: false,
    },
    modifiers: {
      type: "array",
      items: {
        type: "object",
        properties: { prep: strField, value: strField },
        required: ["prep", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["core", "modifiers"],
  additionalProperties: false,
};

const GRAPH_SYSTEM = `
Extract ONE core semantic triple from a claim. ALL content goes into nested S/P/O — no modifiers.

Return ONLY JSON. No markdown. No code fences. No explanations.

Input JSON:
{ "claim": "...", "sentence_context": "..." }

Output EXACTLY:
{
  "core": {
    "subject": "..." or { "subject": ..., "predicate": "...", "object": ... },
    "predicate": "...",
    "object": "..." or { "subject": ..., "predicate": "...", "object": ... }
  },
  "modifiers": []
}

IMPORTANT: modifiers must ALWAYS be an empty array []. All prepositional phrases go into nested subject/object.

RULE PRIORITY (when rules conflict):
1. Faithfulness — preserve the original meaning, tense, modality, and negation exactly.
2. Completeness — every content word from the claim must appear in the output.
3. Reusability — prefer short, reusable atoms (subject/object leaf nodes).
4. Fluency — natural English phrasing in the predicate.
Never sacrifice meaning for shorter atoms.

CORE TRIPLE:
- Subject = grammatical subject (may include more than a word like "Carbon emissions").
- Predicate = main verb/copula + modals (should/must/can/will) + negation (not/never).
  Include adjective complements in the predicate when the verb requires them:
  "makes X worse" => predicate "makes worse", object "X".
- Object = everything after the predicate that carries meaning. Nest prepositional phrases
  as recursive sub-triples (see RECURSIVE SUBJECT/OBJECT).
  Adverbs that are part of the verbal phrase stay in the object:
  "drives capital offshore" => object "capital offshore".
- When a preposition is essential to the verb's meaning (hide X about Y, spread lies about Y,
  invest in Y, rely on Y, profit from Y, spy on Y, worry about Y, belong on/in/to Z,
  depend on Z, result in Z, lead to Z, focus on Z), fold "verb + prep" into the predicate
  so the object is a reusable atom.
- Do NOT output a bare preposition as the CORE predicate (for/in/of/to/by/with).
  Bare prepositions ARE allowed as predicates inside nested sub-triples.

RECURSIVE SUBJECT/OBJECT:
- ALL prepositional phrases in subject or object MUST be nested as sub-triples.
  This includes trailing preps (from/to/in/on/for/by/with/about/of/within/through/over/against),
  relative clauses (who/which/that + verb), participial phrases, and infinitive clauses.
- Use nested triples for:
  * Relative clauses: "People who rely on AI" -> { "subject": "People", "predicate": "who rely on", "object": "AI" }
  * Participial phrases: "Students using ChatGPT" -> { "subject": "Students", "predicate": "using", "object": "ChatGPT" }
  * Prepositional noun phrases: "reposts from TikTok" -> { "subject": "reposts", "predicate": "from", "object": "TikTok" }
  * Multi-level: "People who rely on AI for everyday decisions" ->
    { "subject": { "subject": "People", "predicate": "who rely on", "object": "AI" }, "predicate": "for", "object": "everyday decisions" }
  * Consequence/infinitive: "misinformation fast enough to undermine democratic elections" ->
    { "subject": "misinformation", "predicate": "fast enough to undermine", "object": "democratic elections" }
- SYMMETRY: Apply recursive nesting to BOTH subject AND object independently.
  If the subject uses nesting, check whether the object also contains prepositional
  phrases or restrictive clauses — if so, nest it too.
- Use flat strings ONLY for simple atoms (1-2 words with no preposition).
  3+ words with a preposition MUST be nested.
- Predicate is ALWAYS a flat string (never nested).
  Exception: proper nouns and fixed terms stay flat (e.g. "United States of America", "freedom of speech").
  Exception: quantified "of" (millions of, thousands of, most of, some of, dozens of)
  and attributive "of" (quality of life, cost of living, burden of proof) stay as one flat atom.

ATOM REUSABILITY:
- Leaf atoms (innermost subject/object strings) should be 1-2 words for maximum reusability.
  NEVER truncate if doing so changes WHO/WHAT the claim is about — nest instead.
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
- NEVER strip "than" or comparative "as".

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

WEAK OBJECTS — NEVER use these as the object:
- "it", "this", "that", "things", "something", "everything", "them", "people"
- If the grammatical object is a pronoun, resolve it from context or use the verb's complement.

ATTRIBUTION HINT:
- When the input contains a reporting verb (say, report, argue, claim, believe, etc.),
  PREFER extracting the inner proposition as the core triple.
  "Scientists say air pollution is harmful" → subject "air pollution", predicate "is", object "harmful"
  The pipeline handles attribution separately. But if you include the source, that's OK too.
- Object should be a concept, not a full clause with its own subject-verb-object.

NOISY INPUT: Claims may contain slang, typos, abbreviations, or informal English. Normalize to clean English triples. "gonna" => "will", "aint" => "is not", etc.

EXAMPLES (grouped by pattern family):

--- BASIC (all preps nested into object) ---

Claim: "Ultra-processed foods increase cancer risk by 30%."
=> { "core": { "subject": "Ultra-processed foods", "predicate": "increase",
       "object": { "subject": "cancer risk", "predicate": "by", "object": "30%" } },
     "modifiers": [] }

Claim: "Public trust depends on transparency in scientific research."
=> { "core": { "subject": "Public trust", "predicate": "depends on",
       "object": { "subject": "transparency", "predicate": "in", "object": "scientific research" } },
     "modifiers": [] }

Claim: "All Instagram content is reposts from TikTok."
=> { "core": { "subject": "All Instagram content", "predicate": "is",
       "object": { "subject": "reposts", "predicate": "from", "object": "TikTok" } },
     "modifiers": [] }

--- COMPARISON (than / as...as — keep full comparative in predicate) ---

Claim: "Nuclear energy is safer than coal."
=> { "core": { "subject": "Nuclear energy", "predicate": "is safer than", "object": "coal" },
     "modifiers": [] }

Claim: "Bitcoin is a better store of value than gold."
=> { "core": { "subject": "Bitcoin", "predicate": "is a better store of value than", "object": "gold" },
     "modifiers": [] }

--- CAUSALITY (nest trailing preps into object) ---

Claim: "Rent control makes housing shortages worse."
=> { "core": { "subject": "Rent control", "predicate": "makes worse", "object": "housing shortages" },
     "modifiers": [] }

Claim: "Climate change poses a significant threat to global food security."
=> { "core": { "subject": "Climate change", "predicate": "poses",
       "object": { "subject": "a significant threat", "predicate": "to", "object": "global food security" } },
     "modifiers": [] }

--- NEGATION (preserve not/never/doesn't in predicate) ---

Claim: "Free speech doesn't mean freedom from consequences."
=> { "core": { "subject": "Free speech", "predicate": "doesn't mean",
       "object": { "subject": "freedom", "predicate": "from", "object": "consequences" } },
     "modifiers": [] }

--- MODALITY (preserve should/must/will/can in predicate) ---

Claim: "AI will replace most jobs within the next 10 years."
=> { "core": { "subject": "AI", "predicate": "will replace",
       "object": { "subject": "most jobs", "predicate": "within", "object": "the next 10 years" } },
     "modifiers": [] }

Claim: "The minimum wage should be raised to 20 dollars per hour."
=> { "core": { "subject": "The minimum wage", "predicate": "should be",
       "object": { "subject": "raised", "predicate": "to", "object": "20 dollars per hour" } },
     "modifiers": [] }

--- NOMINALIZATION (unfold "The X of Y" into active predicate) ---

Claim: "The impact of AI in the creative sector will be positive."
=> { "core": { "subject": "AI", "predicate": "will positively impact", "object": "the creative sector" },
     "modifiers": [] }

Claim: "The influence of social media on teenagers is harmful."
=> { "core": { "subject": "Social media", "predicate": "harms", "object": "teenagers" },
     "modifiers": [] }

--- RELATIVE CLAUSE (nest into object/subject) ---

Claim: "AI should regulate citizens who are educated."
=> { "core": { "subject": "AI", "predicate": "should regulate",
       "object": { "subject": "citizens", "predicate": "who are", "object": "educated" } },
     "modifiers": [] }

Claim: "We need policies that reduce carbon emissions."
=> { "core": { "subject": "We", "predicate": "need",
       "object": { "subject": "policies", "predicate": "that reduce", "object": "carbon emissions" } },
     "modifiers": [] }

--- CONSEQUENCE (degree + infinitive in nested predicate) ---

Claim: "Social media amplifies misinformation fast enough to undermine democratic elections."
=> { "core": { "subject": "Social media", "predicate": "amplifies",
       "object": { "subject": "misinformation", "predicate": "fast enough to undermine", "object": "democratic elections" } },
     "modifiers": [] }

--- RECURSIVE SUBJECT (restrictive clause -> nested triple) ---

Claim: "People who rely on AI for everyday decisions gradually lose the ability to think critically on their own."
=> { "core": {
       "subject": { "subject": { "subject": "People", "predicate": "who rely on", "object": "AI" },
                    "predicate": "for", "object": "everyday decisions" },
       "predicate": "gradually lose",
       "object": { "subject": { "subject": "the ability", "predicate": "to think", "object": "critically" },
                    "predicate": "on", "object": "their own" }
     },
     "modifiers": [] }

Claim: "Students using ChatGPT for homework never develop real analytical skills."
=> { "core": {
       "subject": { "subject": { "subject": "Students", "predicate": "using", "object": "ChatGPT" },
                    "predicate": "for", "object": "homework" },
       "predicate": "never develop",
       "object": "real analytical skills"
     },
     "modifiers": [] }

--- RECURSIVE BOTH SIDES ---

Claim: "The sweetness of pineapple balances the saltiness of ham and cheese."
=> { "core": {
       "subject": { "subject": "sweetness", "predicate": "of", "object": "pineapple" },
       "predicate": "balances",
       "object": { "subject": "saltiness", "predicate": "of", "object": "ham and cheese" }
     },
     "modifiers": [] }

--- NOISY INPUT ---

Claim: "ai is gonna take our jobs lol"
=> { "core": { "subject": "AI", "predicate": "will take", "object": "jobs" },
     "modifiers": [] }
`;

export async function runGraphExtraction(model: LanguageModel, prompt: string) {
  const { object } = await generateObject({
    model,
    schema: jsonSchema<GraphOut>(GRAPH_OUT_JSON_SCHEMA, {
      validate: (value) => {
        const result = GraphOutSchema.safeParse(value);
        if (result.success) return { success: true, value: result.data };
        return { success: false, error: new Error(result.error.message) };
      },
    }),
    system: GRAPH_SYSTEM,
    prompt,
  });
  return object;
}
