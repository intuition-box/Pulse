import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { STRONG_ARGUMENT_MARKERS_RE } from "../helpers/rules/extractionRules.js";
import { trackFallback } from "../helpers/fallbackTracker.js";

export const PreFilterSchema = z.object({
  proceed: z.boolean(),
  code: z.enum(["OK", "OFF_TOPIC", "NOT_DEBATABLE", "GIBBERISH"]),
});

export type PreFilterResult = z.infer<typeof PreFilterSchema>;

const PRE_FILTER_SYSTEM = `You are a fast pre-filter for a debate platform.
Given user text and optional parent claim context, decide if it's worth analyzing further.

Return ONLY JSON:
{ "proceed": true|false, "code": "OK"|"OFF_TOPIC"|"NOT_DEBATABLE"|"GIBBERISH" }

Rules:
- OK: text contains at least one debatable proposition (factual, normative, causal, or comparative). If parent context is given, the text must be related to it.
  Examples of OK: "Nuclear energy is safe", "We should ban TikTok", "AI will create more jobs than it destroys", "Shouldn't we invest more in renewables?"
- OFF_TOPIC: text is completely unrelated to the parent claim (only use when parent context is provided).
  Example: parent is about nuclear energy, child says "I love pizza" => OFF_TOPIC
- NOT_DEBATABLE: text is purely rhetoric, filler, bare agreement/disagreement, procedural question, or emotion with no argument.
  Examples: "yes I agree", "exactly", "nonsense", "lol what", "Can you explain?", "Good point!"
  NOT examples of NOT_DEBATABLE (these should be OK):
  - "I agree because nuclear has the lowest death rate" (has a proposition)
  - "Don't you think AI is dangerous?" (rhetorical question with embedded claim)
  - "That's wrong, the data clearly shows emissions have dropped" (disagreement + argument)
  - "Exactly, and this proves that regulation works" (agreement + new proposition)
  - "No, because the studies were flawed" (rebuttal with reason)
  - "Yes but only if we invest in infrastructure" (conditional agreement)
  - "We should invest more in nuclear energy" (normative claim)
  - "If we ban encryption, privacy is dead" (conditional claim)
  - "Democracy only works when citizens are educated" (conditional normative)
- GIBBERISH: text is spam, random characters, keyboard mashing, or nonsensical.
  Examples: "asdfghjkl", "!!!!!!", "buy crypto at scam.xyz"

Be lenient: if in doubt, return OK. False negatives (letting something through) are cheaper than false positives (blocking valid text).

ARGUMENT MARKERS — if the text contains ANY of these, it is ALWAYS OK (never NOT_DEBATABLE):
- Causal: because, since (non-temporal), therefore, thus, hence, consequently, so that, in order to
- Conditional: if, unless, when, only when, as long as, provided that, even though
- Normative: should, must, ought to, need to
- Contrast: but, however, although, yet, nevertheless, despite, whereas
- Evidence: the data shows, studies show, research suggests, evidence indicates
These markers signal an argument structure → always proceed.

EDGE CASES:
- Sarcasm/irony ("Oh sure, nuclear is totally harmless"): return OK. The proposition is debatable.
- Counterfactuals ("If we had invested in nuclear, CO2 would be lower"): return OK. Causal claim.
- Mixed text ("lol but seriously, AI will take our jobs"): return OK. Ignore filler, extract proposition.

`;

export async function runPreFilter(
  model: LanguageModel,
  inputText: string,
  parentClaimText?: string | null,
): Promise<PreFilterResult> {
  const prompt = parentClaimText
    ? JSON.stringify({ text: inputText, parent_claim: parentClaimText })
    : JSON.stringify({ text: inputText });

  const { object } = await generateObject({
    model,
    schema: PreFilterSchema,
    system: PRE_FILTER_SYSTEM,
    prompt,
    providerOptions: { groq: { structuredOutputs: true } },
  });

  if (!object.proceed && object.code === "NOT_DEBATABLE" && STRONG_ARGUMENT_MARKERS_RE.test(inputText)) {
    trackFallback("preFilter:argumentMarkerOverride");
    return { proceed: true, code: "OK" };
  }

  return object;
}
