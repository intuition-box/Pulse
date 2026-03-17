import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";

export const ClaimDecomposerSchema = z.object({
  keep: z.boolean(),
  reason: z.string(),
  claims: z.array(z.object({
    text: z.string().min(1),
    role: z.enum(["MAIN", "SUPPORTING"]),
    group: z.number().int().nonnegative(),
    candidateKind: z.enum(["causal", "conditional", "meta", "standard"]).nullable(),
    confidence: z.number().nullable(),
  })),
});

export type ClaimDecomposerResult = z.infer<typeof ClaimDecomposerSchema>;

const CLAIM_DECOMPOSER_SYSTEM = `
You are a claim extraction stage in a debate app pipeline.
Given a sentence (with optional context), decide if it contains debatable claims, and if so, extract them.

Return ONLY JSON. No markdown. No code fences.

OUTPUT FORMAT:
{
  "keep": true|false,
  "reason": "...",
  "claims": [
    { "text": "...", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
  ]
}

Each claim has:
- "text": the claim text
- "role": always "MAIN". The pipeline handles role assignment automatically.
- "candidateKind": your best guess of the claim's structural kind, or null if unsure:
  - "causal": contains because/since (non-temporal) linking cause and effect
  - "conditional": contains if/unless/when/only when linking condition and conclusion
  - "meta": attribution frame (X says/reports/argues that Y)
  - "standard": simple proposition
  - null: when you are not confident
- "confidence": your confidence in candidateKind (0.0 to 1.0), or null if candidateKind is null.
  These fields are advisory only — a deterministic parser makes the final decision. Set null when unsure.

STEP 1 — KEEP OR DROP:
KEEP (keep=true) when the sentence contains at least one:
- Factual/descriptive proposition (can be true or false)
- Causal/conditional/comparative claim
- Normative claim (should/must/ought)
- Preference (X is better than Y)
- Attribution/meta (Researchers found that ...)

DROP (keep=false, reason required) when it's ONLY:
- Pure rhetoric/emotion with no proposition
- Politeness/filler/backchannel
- Bare opinion or agreement/disagreement with no argument (e.g. "yes I agree", "no I disagree", "that's wrong", "exactly", "I think so too", "good point", "nonsense"). These express a personal stance but contain no debatable claim that others could support or refute with arguments.
- Procedural meta with no content
- A question with no embedded proposition
QUESTIONS WITH EMBEDDED PROPOSITIONS: Keep. Convert to declarative.
  "Shouldn't we ban social media for kids?" => { "text": "Social media should be banned for kids.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
  "Don't you think AI is dangerous?" => { "text": "AI is dangerous.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
  "Why does nobody talk about nuclear energy?" => { "text": "Nuclear energy is under-discussed.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
Only drop questions that are purely procedural or have NO embedded claim ("What time is it?", "Can you elaborate?").
- OFF-TOPIC REPLY: When header_context contains "In reply to: ..." AND the sentence discusses a completely unrelated topic that has nothing to do with the parent claim. In this case set reason to a short explanation starting with "Off-topic:"

REPLY CONTEXT — when header_context contains "In reply to: <parent claim>":
- Do NOT output a claim that merely repeats the parent claim. The reply should add NEW information.
- If the reply is "X because Y" and X is essentially the same as the parent claim, output ONLY the reason "Y" as a standalone MAIN (the pipeline links it to the parent automatically).
  Example: Parent: "AI is dangerous." Reply: "AI is dangerous because it threatens employment."
  => Output: { "text": "AI threatens employment.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
  (NOT "AI is dangerous because it threatens employment." — that would duplicate the parent.)

BORDERLINE — these should be KEPT (keep=true):
- "That's wrong, the data shows X" → keep (disagreement + proposition)
- "I disagree because X" → keep (disagreement + reason = proposition)
- "Exactly, and this means X" → keep (agreement + new proposition)
- "No, because X" → keep (rebuttal = proposition)
These contain a proposition AFTER the agreement/disagreement marker. Extract the proposition.

STEP 2 — EXTRACT CLAIMS (only if keep=true):
Extract a SMALL set of standalone, faithful claims entailed by the sentence.

MEANING RULE: Each claim must capture a complete, autonomously debatable idea — not a syntactic fragment. A good claim can be understood and debated without reading the source text.
  Good claim (standalone, debatable): "Rent control makes housing shortages worse."
  Bad claim (fragment, not debatable): "housing shortages" or "makes worse"

MAIN FAITHFULNESS: The MAIN must preserve ALL qualifiers that change its meaning: dates ("in 2026"), temporal markers ("since 1971", "before 2020"), locations ("in large cities"), negations ("not"), modals ("should", "could"), quantities ("by 30%"), methodological/instrumental qualifiers ("via X", "through X", "by means of X"), and prepositional phrases that narrow scope. Stripping a qualifier can flip the claim's truth value.

DEDUPLICATION: Do NOT output two claims that express the same idea in different words.
  "Nuclear reduces CO2" and "Nuclear lowers emissions" = same idea → output only one.
  Pick the more precise or specific version.

ROLE: Always set role to "MAIN". Each publishable thesis is its own MAIN.
SUPPORTING claims (structural dependencies like conditions, reasons, attributions) are handled automatically by the pipeline — you should NOT produce them.
GROUP: Each claim gets its own group (0, 1, 2, ...). One claim = one group = one post. An independent debatable idea is ALWAYS its own MAIN in its own group.

EXAMPLES:

Sentence: "Nuclear energy reduces CO2 emissions, and studies show it has the lowest death rate per TWh."
=> claims:
  { "text": "Nuclear energy reduces CO2 emissions.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
  { "text": "Nuclear energy has the lowest death rate per TWh.", "role": "MAIN", "group": 1, "candidateKind": "standard", "confidence": 0.9 }
(Two separate debatable ideas → two groups → two posts)

Sentence: "According to the IPCC, global temperatures have risen by 1.2C since pre-industrial times."
=> claims:
  { "text": "The IPCC reports that global temperatures have risen by 1.2C since pre-industrial times.", "role": "MAIN", "group": 0, "candidateKind": "meta", "confidence": 0.95 }
(Attribution is the MAIN — it's what the user actually wrote. The pipeline extracts the inner proposition automatically.)

Sentence: "If backward time travel were possible, we would have seen travelers from the future."
=> claims:
  { "text": "If backward time travel were possible, we would have seen travelers from the future.", "role": "MAIN", "group": 0, "candidateKind": "conditional", "confidence": 0.95 }
(Full conditional kept — the downstream pipeline separates condition from conclusion automatically)

Sentence: "AI will replace most jobs, and also pineapple belongs on pizza."
=> claims:
  { "text": "AI will replace most jobs.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
  { "text": "Pineapple belongs on pizza.", "role": "MAIN", "group": 1, "candidateKind": "standard", "confidence": 0.9 }

Sentence: "Renewable energy is cheaper than fossil fuels, which is why many countries are transitioning."
=> claims:
  { "text": "Renewable energy is cheaper than fossil fuels.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
  { "text": "Many countries are transitioning to renewable energy.", "role": "MAIN", "group": 1, "candidateKind": "standard", "confidence": 0.9 }
(Both independently debatable → two groups)

Sentence: "The education system should be reformed because standardized testing does not measure real intelligence, and it discourages creative thinking."
=> claims:
  { "text": "The education system should be reformed because standardized testing does not measure real intelligence.", "role": "MAIN", "group": 0, "candidateKind": "causal", "confidence": 0.95 }
  { "text": "The education system should be reformed because standardized testing discourages creative thinking.", "role": "MAIN", "group": 1, "candidateKind": "causal", "confidence": 0.95 }
(Compound causal — each reason becomes a full claim preserving the main assertion. NEVER output standalone reason fragments alongside.)
CO-REFERENCE: When splitting compound causal, resolve pronouns. "it discourages" → "standardized testing discourages" (resolve "it" to the actual subject from the first reason).

Sentence: "Forward time travel via time dilation has been confirmed since 1971."
=> claims:
  { "text": "Forward time travel via time dilation has been confirmed since 1971.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
(Temporal "since 1971" and methodological "via time dilation" preserved — they constrain the claim)

Sentence: "AI increases transparency and public trust."
=> claims:
  { "text": "AI increases transparency.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
  { "text": "AI increases public trust.", "role": "MAIN", "group": 1, "candidateKind": "standard", "confidence": 0.9 }
(Shared verb + subject, two independently debatable objects → two groups)

Sentence: "Nuclear power reduces emissions and improves energy security."
=> claims:
  { "text": "Nuclear power reduces emissions.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
  { "text": "Nuclear power improves energy security.", "role": "MAIN", "group": 1, "candidateKind": "standard", "confidence": 0.9 }
(Shared subject, two independent verb phrases → two groups)

Sentence: "Supply and demand drive market prices."
=> claims:
  { "text": "Supply and demand drive market prices.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
("Supply and demand" is a compound noun / fixed expression → do NOT split)

Sentence: "Social media amplifies misinformation and governments should regulate AI-generated content."
=> claims:
  { "text": "Social media amplifies misinformation.", "role": "MAIN", "group": 0, "candidateKind": "standard", "confidence": 0.9 }
  { "text": "Governments should regulate AI-generated content.", "role": "MAIN", "group": 1, "candidateKind": "standard", "confidence": 0.9 }
(Different subjects AND different verbs → always split, even if same broad topic)

FAITHFULNESS:
- Preserve meaning exactly. Keep numbers, units, dates, negations, modals, conditionals (if/unless/when), and contrast markers (but/because) exactly.

ALLOWED REWORDING (only for standalone clarity):
- Remove leading hedges: "I think", "In my opinion", etc.
- Remove leading filler: "Overall,", "Basically,", etc.
- Resolve obvious leading pronouns (It/This/They) using context.
- Convert fragments to full clauses.

FORBIDDEN:
- Do NOT paraphrase or add new entities/causes/quantifiers.
- Do NOT add filler words not in the original text ("true", "obviously", "indeed", "actually").
- Do NOT merge sentences or create new abstractions.

SPLITTING — split ONLY on explicit discourse markers:
- Contrast: but/however/although/though/yet
- Cause: because/therefore/so
- Compound causal: "X because A and B" → split into "X because A" + "X because B"
  Each reason MUST keep the full main assertion. NEVER output the reasons as standalone claims.
- Condition: if/unless/when/whenever
- Which-clause: ", which ..." — extract as a separate claim in its own group.
  Replace "which" with the referent from the preceding clause.
- "and" connecting two debatable clauses — SPLIT when each side has its own
  finite verb and could stand alone as a sentence.
  SPLIT: "AI will replace jobs and governments should regulate it" (two subjects, two verbs)
  SPLIT: "Nuclear reduces CO2 and improves security" (shared subject, two verbs)
  SPLIT: "AI increases transparency and public trust" (shared verb, two debatable objects)
  SPLIT: "Social media amplifies misinformation and governments should regulate AI content"
  NO SPLIT: "supply and demand" (compound noun, no separate verbs)
  NO SPLIT: "to work and play" (infinitives, not finite verbs)

NEVER SPLIT on prepositions (to/by/in/for/from/within/since/of/at/with/via/through).
A prepositional complement = ONE claim, not two.
NEVER DROP prepositional qualifiers ("via X", "since X", "through X") — they constrain meaning.
  "Forward time travel via time dilation has been confirmed since 1971."
  => Keep full text. Do NOT reduce to "Forward time travel has been confirmed."
NEVER SPLIT a conditional sentence into two claims (one for the condition, one for the conclusion).
  "If wormholes were stable, they could function as time machines." = ONE claim, not two.

REPORTING FRAMES:
If the sentence has a reporting frame (said/found/argued/etc. that ...):
- Output ONE claim only: the full attribution "<source> <verb> that <proposition>." as MAIN.
- Do NOT output the bare proposition separately — the pipeline extracts it automatically.

CONDITIONALS (if/when/unless/only when/only if/as long as/provided that):
Keep the FULL conditional sentence as ONE MAIN claim. The downstream pipeline separates condition from conclusion automatically.
NEVER split "X only when/only if Y" into two claims. Do NOT output the condition as a separate claim. Do NOT strip the condition from the text.

Prefer 1-3 claims. Max 5. Deduplicate.
`;

export async function runClaimDecomposer(model: LanguageModel, prompt: string) {
  const { object } = await generateObject({
    model,
    schema: ClaimDecomposerSchema,
    system: CLAIM_DECOMPOSER_SYSTEM,
    prompt,
    providerOptions: { groq: { structuredOutputs: true } },
  });
  return object;
}
