import { tool, stepCountIs, zodSchema } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { z } from "zod";

export type RefineProposal = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  role: "primary" | "supporting";

  postNumber?: number;
};

export type SearchAtomsFn = (query: string, limit: number) => Promise<Array<{
  termId: string; label: string;
  holders: number | null; shares: number | null; marketCap: number | null; sharePrice: number | null;
}>>;
export type SearchTriplesFn = (query: string, limit: number) => Promise<Array<{
  termId: string; subject: string; predicate: string; object: string;
  holders: number | null; shares: number | null; marketCap: number | null; sharePrice: number | null;
  counterHolders: number | null; counterShares: number | null; counterMarketCap: number | null; counterSharePrice: number | null;
}>>;

export type RefineChatOptions = {
  model: LanguageModel;
  messages: ModelMessage[];
  proposals: RefineProposal[];
  sourceText: string;
  themeTitle?: string;
  parentClaim?: string;
  searchAtoms?: SearchAtomsFn;
  searchTriples?: SearchTriplesFn;
  reasoningSummary?: string;
  draftPosts?: Array<{ body: string }>;
};

function buildSystemPrompt(opts: Pick<RefineChatOptions, "sourceText" | "themeTitle" | "parentClaim" | "proposals" | "reasoningSummary" | "draftPosts">) {
  const proposalList = opts.proposals
    .map((p, i) => {
      const postLabel = p.postNumber != null ? `Post ${p.postNumber}` : `#${i + 1}`;
      return `  ${postLabel}. [${p.id}] ${p.subject} | ${p.predicate} | ${p.object}`;
    })
    .join("\n");

  const bodiesBlock = opts.draftPosts?.length
    ? "\n\nCURRENT POST BODIES:\n" + opts.draftPosts.map((d, i) => `  Post ${i + 1}: "${d.body}"`).join("\n")
    : "";

  const postNumbers = new Set(opts.proposals.map((p) => p.postNumber).filter((n): n is number => n != null));
  let multiPostBlock = "";
  if (postNumbers.size > 1) {
    const lines = Array.from(postNumbers).sort((a, b) => a - b).map((num) => {
      const main = opts.proposals.find((p) => p.postNumber === num && p.role === "primary");
      const label = main ? `${main.subject} | ${main.predicate} | ${main.object}` : "(no primary)";
      return `  Post ${num}: ${label}`;
    });
    multiPostBlock = `\n\n## Posts\nThis content has been split into ${postNumbers.size} posts:\n${lines.join("\n")}\nWhen the user refers to a specific post, use the post number.`;
  }

  const reasoningBlock = opts.reasoningSummary
    ? `\n\nEXTRACTION REASONING (context only, already shown to user):\n${opts.reasoningSummary}\nReference this when the user asks about matching decisions.`
    : "";

  return `You are a debate coach helping users refine their claims. Be supportive, direct, and concise.

## Context

Each proposal is a semantic triple: Subject | Predicate | Object.

CURRENT PROPOSALS:
${proposalList}${bodiesBlock}

SOURCE TEXT: "${opts.sourceText}"
${opts.themeTitle ? `THEME: "${opts.themeTitle}"` : ""}
${opts.parentClaim ? `REPLYING TO: "${opts.parentClaim}"` : ""}${multiPostBlock}${reasoningBlock}

## Tools

- **update_triple**: Edit a field's text. This DISCONNECTS any linked atom — only use for text changes.
- **link_atom**: Link an existing on-chain atom to a field. Use scope="global" (default) to propagate the atom to all proposals sharing the same concept. Use scope="local" for a single proposal only. The UI handles propagation automatically.
- **search_atoms**: Search on-chain atoms. Provide proposalId and field when searching for a specific slot. The UI displays results with metrics — focus on explaining WHY an alternative is better.
- **search_triples**: Search existing claims on-chain.
- **add_triple**: Add a new claim (only if supported by source text). Use postNumber for multi-post.
- **remove_triple**: Remove a claim the user wants to discard.
- **update_post_body**: Change the human-readable post body text (distinct from the triple).
- **split_posts**: Split into separate posts. Use ONLY on explicit user request. Never suggest splitting proactively.

## Rules

1. **Execute directly** — apply changes with tools, then confirm what you did. Do NOT ask "Should I update?" before acting.
2. **Stay faithful** to the source text. Refuse modifications that contradict or go beyond it. Suggest alternatives.
3. **Short responses** (1-3 sentences). Present results step by step — summary first, then modification. No visual overload.
4. **Atoms**: Always use link_atom (not update_triple) when linking existing atoms. Search first, then link.
5. **Propagation**: When using link_atom with scope="global", propagation happens automatically in the UI. With scope="local", only the targeted claim is updated.
6. **Metrics**: The UI displays metrics (participants, market cap) automatically. Focus on explaining why an alternative might be better, not on repeating numbers.
7. **Coherence**: Before suggesting an alternative atom, verify it stays coherent with the source text and the claim's meaning.
8. Never show on-chain IDs (0x...) to the user. Always use human-readable labels.
9. **Multi-post**: Use postNumber in add_triple to target the right post. When there are multiple posts, reference them by number (Post 1, Post 2, etc.).
10. **Tool feedback**: After using a tool, wait for the result before confirming to the user. Never say "Done" or "Updated" before receiving the tool result.
11. **Blocked tools**: Some tool calls may be blocked by the system guard. If a tool is blocked, the user will see a warning. Do not assume tools always succeed.
12. **Conciseness**: Keep responses under 2 sentences unless the user asks for details.
13. **Splitting**: NEVER suggest splitting proactively. Only execute split_posts when user explicitly asks. If ambiguous, ask a short clarifying question. Flow: remove_triple → add_triple × N → split_posts.
14. **Nested triples**: Some proposals are structural links (IDs starting with "nested:"). They represent how claims relate to each other (e.g., conditions, modifiers). You can edit them with update_triple the same way as regular proposals.`;
}

const updateTripleTool = tool({
  description: "Update a field (subject, predicate, or object) of a proposal triple.",
  inputSchema: zodSchema(
    z.object({
      proposalId: z.string().describe("The proposal ID to update"),
      field: z.enum(["subject", "predicate", "object"]).describe("Which field to update"),
      value: z.string().min(1).describe("The new value for the field"),
    }),
  ),
});

const addTripleTool = tool({
  description: "Add a new proposal triple. Only use if the source text supports a claim not yet captured.",
  inputSchema: zodSchema(
    z.object({
      subject: z.string().min(1),
      predicate: z.string().min(1),
      object: z.string().min(1),
      postNumber: z.number().int().min(1)
        .describe("Target post number (1-based). Required."),
    }),
  ),
});

const removeTripleTool = tool({
  description: "Remove a proposal that the user wants to discard.",
  inputSchema: zodSchema(
    z.object({
      proposalId: z.string().describe("The proposal ID to remove"),
    }),
  ),
});

const linkAtomTool = tool({
  description:
    "Link an existing on-chain atom to a proposal field. " +
    "Use this INSTEAD of update_triple when the user wants to reuse an atom that already exists on-chain. " +
    "First search with search_atoms, then call this with the termId and label from the search results. " +
    "With scope='global' (default), the atom is propagated to ALL proposals sharing the same concept.",
  inputSchema: zodSchema(
    z.object({
      proposalId: z.string().describe("The proposal ID to update"),
      field: z.enum(["subject", "predicate", "object"]).describe("Which field to link"),
      atomId: z.string().describe("The on-chain term ID of the existing atom"),
      label: z.string().min(1).describe("The human-readable label of the atom"),
      scope: z.enum(["global", "local"]).default("global")
        .describe("'global': propagate to all proposals with the same concept. 'local': only update this proposal."),
    }),
  ),
});

const splitPostsTool = tool({
  description: "Split claims into separate posts — each active proposal becomes its own post. Use ONLY when the user explicitly asks to split.",
  inputSchema: zodSchema(z.object({})),
});

const updatePostBodyTool = tool({
  description: "Update the body text of a draft post. Use when the user asks to rephrase or modify the post text (not the triple fields).",
  inputSchema: zodSchema(
    z.object({
      postNumber: z.number().int().min(1).describe("The post number (1-based)"),
      body: z.string().min(1).describe("The new body text"),
    }),
  ),
});

function makeSearchAtomsTool(searchFn?: SearchAtomsFn) {
  return tool({
    description: "Search for existing atoms (concepts) on-chain by keyword. Provide proposalId and field when searching for a specific claim slot.",
    inputSchema: zodSchema(
      z.object({
        query: z.string().min(1).describe("Search keyword"),
        limit: z.number().int().min(1).max(20).default(5),
        proposalId: z.string().optional().describe("The proposal ID this search is for (if applicable)"),
        field: z.enum(["subject", "predicate", "object"]).optional().describe("The field being searched"),
      }),
    ),
    execute: searchFn
      ? async ({ query, limit }) => {
          const results = await searchFn(query, limit);
          return { results };
        }
      : async () => ({ results: [], message: "Search unavailable" }),
  });
}

function makeSearchTriplesTool(searchFn?: SearchTriplesFn) {
  return tool({
    description: "Search for existing triples (claims) on-chain by keyword.",
    inputSchema: zodSchema(
      z.object({
        query: z.string().min(1).describe("Search keyword"),
        limit: z.number().int().min(1).max(20).default(5),
      }),
    ),
    execute: searchFn
      ? async ({ query, limit }) => {
          const results = await searchFn(query, limit);
          return { results };
        }
      : async () => ({ results: [], message: "Search unavailable" }),
  });
}

export function getRefineStreamConfig(opts: RefineChatOptions) {
  return {
    model: opts.model,
    system: buildSystemPrompt(opts),
    messages: opts.messages,
    tools: {
      update_triple: updateTripleTool,
      add_triple: addTripleTool,
      remove_triple: removeTripleTool,
      link_atom: linkAtomTool,
      update_post_body: updatePostBodyTool,
      search_atoms: makeSearchAtomsTool(opts.searchAtoms),
      search_triples: makeSearchTriplesTool(opts.searchTriples),
      split_posts: splitPostsTool,
    },
    stopWhen: stepCountIs(5),
  } as const;
}
