

export const CAUSAL_MARKERS_RE = /\b(because|since)\b/i;

export const TEMPORAL_SINCE_RE =
  /^since\s+(\d{4}|\d{1,2}\b|january|february|march|april|may|june|july|august|september|october|november|december|last\s|the\s+(beginning|start|end|dawn)|then\b|early\b|mid\b|late\b)/i;

export const NORMATIVE_RE = /\b(should|must|ought|need\s+to)\b/i;

export const COMPOUND_NOUN_BLOCKLIST_RE = /\b(supply and demand|research and development|trial and error|law and order|pros and cons|rock and roll|cause and effect)\b/i;

export const AUXILIARIES_RE = /^(does|do|is|are|was|were|has|have|had|can|will|shall|should|would|could|may|might)\b/i;

export const CAUSAL_PREDS = new Set(["because", "therefore", "so", "since"]);

export const CAUSAL_SENTENCE_RE = /\b(because|since|therefore|so)\b/i;

export const RELATION_MARKERS_RE = /\b(but|however|although|though|yet|because|therefore|hence|thus|so|if|unless|when)\b|\b(could|may|might|will)\s+lead\s+to\b/i;

export const ALLOWED_RELATION_PREDICATES = new Set([
  "but", "however", "although", "because", "therefore", "so",
  "if", "unless", "when",
  "could lead to", "may lead to", "might lead to", "will lead to",
]);

export const REPORTING_VERBS = new Set([
  "say", "said", "says",
  "suggest", "suggests", "suggested",
  "find", "finds", "found",
  "report", "reports", "reported",
  "estimate", "estimates", "estimated",
  "predict", "predicts", "predicted",
  "argue", "argues", "argued",
  "promise", "promises", "promised",
  "claim", "claims", "claimed",
  "state", "states", "stated",
  "believe", "believes", "believed",
  "think", "thinks", "thought",
  "assert", "asserts", "asserted",
]);

export const PROBABLE_VERB_RE = /\b(?:is|are|was|were|has|have|had|do|does|did|can|will|may|should|could|would|might)\b|\w+(?:es|ed|ing|[^s]s)\b/i;

export const COMPOUND_CONDITIONAL_KW: Record<string, "if" | "unless" | "when"> = {
  "only when": "when",
  "only if": "if",
  "even if": "if",
  "even when": "when",
  "as long as": "if",
  "provided that": "if",
};

export const WEAK_OBJECT_PLACEHOLDERS = new Set([
  "it",
  "this",
  "that",
  "something",
  "anything",
  "everything",
  "nothing",
]);

export const COPULA_RE = /^(.+?)\s+(is|are|was|were)\s+(.+)$/i;

export const MODAL_EXTRACT_RE = /^(.+?)\s+(can|should|must|will|may|might|could|would)\s+(\w+)\s+(.+)$/i;

export const TRANSITIVE_RE = /^(.+?)\s+(has|have|had|makes?|causes?|creates?|reduces?|increases?|requires?|allows?|enables?|prevents?)\s+(.+)$/i;

export const FILLER_SUBJECTS_RE = /^(it|there|this|that|these|those|they|he|she|we)$/i;

export const DECOMPOSE_PREPS_RE = /^(.+?)\s+(under|over|above|below|before|after|between|within|of|for|in|at|from|to|with|without|against|about|on|through|since|by)\s+(.+)$/i;

export const RELATIVE_CLAUSE_RE = /\b(who|whose|which)\b/i;

export const IDENTITY_VERBS_RE = /\b(is|are|was|were|be|means?|equals?|represents?|constitutes?)\b/i;

export const COMPARATIVE_RE = /\b(\w+er|more|less|better|worse|greater|fewer)\b.*\bthan\b/i;

export const NEGATION_RE = /\b(not|never|n't|cannot)\b/i;

export const MODAL_CHECK_RE = /\b(should|must|will|can|may|might|could|would)\b/i;

export const CONDITION_RE = /\b(if|unless|when|only\s+when|only\s+if|as long as|provided that)\b/i;

export const PREP_ONLY_RE = /^(in|of|for|to|by|with|at|on|from|about|through|under|over|between)$/i;

export const STRONG_ARGUMENT_MARKERS_RE = /\b(because|since|therefore|if|unless|when|should|must|ought|however|but|although|yet|thus|hence|so\s+that|despite|whereas|even\s+though|nevertheless|consequently|in\s+order\s+to)\b/i;

export const CAUSAL_COVERAGE_THRESHOLD = 0.8;

export const SHORT_REASON_MAX_WORDS = 4;

export const CAUSAL_BEFORE_MIN_WORDS = 2;

export const SUB_PROPOSITION_MIN_WORDS = 3;
export const SUB_PROPOSITION_MAX_WORDS = 12;

export const CLAIM_DEDUP_THRESHOLD = 0.8;

export const TRIPLE_DEDUP_THRESHOLD = 0.7;

export const REPLY_PARENT_MATCH_THRESHOLD = 0.75;
