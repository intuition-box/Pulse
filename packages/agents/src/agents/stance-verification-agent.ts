import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";


export const StanceVerificationSchema = z.object({
  verifications: z.array(
    z.object({
      stableKey: z.string(),
      isRelevant: z.boolean(),
      alignsWithStance: z.boolean(),
      suggestedStance: z.enum(["SUPPORTS", "REFUTES"]),
      reason: z.string(),
    })
  ),
});

export type StanceVerification = z.infer<typeof StanceVerificationSchema>;

const STANCE_SYSTEM = `
You are a semantic stance and relevance classifier.

Given a parent claim and a user's declared stance (SUPPORTS or REFUTES), determine:
1. Whether each child claim is RELEVANT to the parent claim's topic
2. If relevant, whether it aligns with the user's declared stance

Return ONLY JSON. No markdown. No code fences. No explanations.

INPUT JSON:
{
  "parentClaim": "...",
  "userStance": "SUPPORTS",
  "claims": [
    { "stableKey": "abc123", "text": "...", "triple": "S | P | O" }
  ]
}

OUTPUT JSON:
{
  "verifications": [
    { "stableKey": "abc123", "isRelevant": true, "alignsWithStance": true, "suggestedStance": "SUPPORTS", "reason": "" }
  ]
}

STEP 1 — RELEVANCE CHECK:
A claim is RELEVANT (isRelevant=true) if it addresses the same topic, domain, or subject matter as the parent claim.
A claim is IRRELEVANT (isRelevant=false) if it discusses a completely unrelated topic.

Examples of IRRELEVANT:
- Parent: "Governments hide the Earth's shape" → Child: "Remote work is more productive" (unrelated topic)
- Parent: "Bitcoin mining wastes energy" → Child: "Dogs make better pets than cats" (unrelated topic)

Examples of RELEVANT (even if they disagree):
- Parent: "Nuclear energy is safest" → Child: "Chernobyl caused thousands of deaths" (same topic: nuclear safety)
- Parent: "Remote work reduces productivity" → Child: "Office distractions are worse" (same topic: work productivity)

When isRelevant=false: set alignsWithStance=false, suggestedStance to either value, and reason explaining it's off-topic.

STEP 2 — STANCE CLASSIFICATION (only when isRelevant=true):
Your classification is SEMANTIC, not grammatical.

SUPPORTS means the child claim reinforces, confirms, extends, provides evidence for, or agrees with the parent claim.
REFUTES means the child claim contradicts, limits, weakens, provides a counter-argument to, or disagrees with the parent claim.

KEY PRINCIPLES:
- A grammatically positive claim can REFUTE: "Solar is cheaper" refutes "Nuclear is the best energy source"
- A grammatically negative claim can SUPPORT: "Pollution isn't decreasing" supports "We need stronger climate policy"
- Focus on the semantic relationship between child and parent, not on the grammar of the child alone
- Consider the full meaning of the triple (S | P | O), not just individual terms
- IMPLICIT PREMISES: Some parent claims rest on unstated assumptions. If a child claim contradicts that underlying assumption, it REFUTES the parent — even if it discusses the same topic. Do NOT confuse "stating a fact about the same topic" with "supporting the parent claim".

OUTPUT RULES:
- For EACH claim in the input, produce EXACTLY ONE entry in verifications with the SAME stableKey
- Set isRelevant based on topical relevance to the parent
- Set suggestedStance to SUPPORTS or REFUTES based on your semantic analysis
- Set alignsWithStance to true if suggestedStance matches userStance, false otherwise
- Always provide a reason when isRelevant=false or alignsWithStance=false
- When isRelevant=true and alignsWithStance=true, reason is optional

EXAMPLES:

Parent: "Nuclear energy is the safest form of power generation"
UserStance: SUPPORTS
Claim: "Nuclear has the lowest death rate per TWh" => isRelevant=true, SUPPORTS
Claim: "Chernobyl caused thousands of deaths" => isRelevant=true, REFUTES
Claim: "Dogs are loyal companions" => isRelevant=false (unrelated to energy/safety)

Parent: "Remote work reduces productivity"
UserStance: REFUTES
Claim: "Studies show remote workers complete more tasks" => isRelevant=true, REFUTES
Claim: "Home distractions lower focus" => isRelevant=true, SUPPORTS (misaligned)
Claim: "The Earth is flat" => isRelevant=false (unrelated to work/productivity)

NUANCED CASES:

Parent: "AI will replace most jobs within 10 years"
UserStance: SUPPORTS
Claim: "AI will automate repetitive tasks" => isRelevant=true, SUPPORTS (partial support — automation leads toward replacement)
Claim: "AI will create new job categories" => isRelevant=true, REFUTES (creating jobs contradicts replacing most)
Claim: "AI development requires significant investment" => isRelevant=true, SUPPORTS (investment in AI enables replacement), reason: "Tangentially related — investment supports the premise that AI is advancing toward job replacement"

IMPLICIT PREMISE CASES:

Parent: "Governments hide information about the true shape of the Earth"
(Implicit premise: the Earth's commonly accepted shape is wrong, i.e., "the Earth is flat")
UserStance: REFUTES
Claim: "The Earth is not flat" => isRelevant=true, REFUTES (directly contradicts the conspiracy's underlying premise that the Earth is flat — this undermines the parent claim)
Claim: "Multiple whistleblowers have confirmed the cover-up" => isRelevant=true, SUPPORTS (misaligned — provides evidence FOR the conspiracy)

Parent: "Vaccines cause autism in children"
(Implicit premise: there is a causal link between vaccines and autism)
UserStance: REFUTES
Claim: "Studies show no link between vaccines and autism" => isRelevant=true, REFUTES (directly attacks the parent's causal premise)
Claim: "Autism diagnoses have risen alongside vaccination rates" => isRelevant=true, SUPPORTS (misaligned — provides correlational evidence for the parent)

NON-CONSPIRACY IMPLICIT PREMISES:

Parent: "Public transportation should replace private cars in cities."
(Implicit premise: private cars are the default/status quo for urban transport)
UserStance: SUPPORTS
Claim: "Cities with strong public transit have lower carbon emissions" => isRelevant=true, SUPPORTS (provides evidence for the policy)
Claim: "Many people live in areas with no public transit access" => isRelevant=true, REFUTES (practical barrier to the policy)

Parent: "University education should be free for all citizens."
(Implicit premise: the cost of university education is a barrier worth removing)
UserStance: REFUTES
Claim: "Free tuition would increase national debt significantly" => isRelevant=true, REFUTES (argument against the policy — aligns with REFUTES stance)
Claim: "Education is a fundamental right" => isRelevant=true, SUPPORTS (misaligned — argues for the parent)

For non-conspiracy implicit premises, the same logic applies: identify the unstated assumption behind the parent claim and classify the child's semantic relationship accordingly.

When stance is genuinely ambiguous, classify based on the strongest semantic signal and always provide a detailed reason. Do NOT default to the user's declared stance — an honest classification is more useful than an agreeable one.
`;

export async function runStanceVerification(model: LanguageModel, prompt: string) {
  const { object } = await generateObject({
    model,
    schema: StanceVerificationSchema,
    system: STANCE_SYSTEM,
    prompt,
    providerOptions: { groq: { structuredOutputs: true } },
  });
  return object;
}
