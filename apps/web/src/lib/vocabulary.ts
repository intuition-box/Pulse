export const labels = {
  roleMain: "Primary",
  roleSupporting: "Supporting",
  selectMain: "Set as primary",
  addTriple: "+ Add claim",

  reuseSuggestionsTitle: "Similar existing claims",
  reuseExactMatch: "Identical claim",
  reuseFor: "For",
  reuseAgainst: "Against",
  reuseSearching: "Searching for similar claims…",
  reuseReusing: "Reusing claim",

  nestedBadgeCondition: "condition",
  nestedBadgeMeta: "attribution",
  nestedBadgeRelation: "link",
  nestedBadgeModifier: "modifier",

  metricParticipants: "Participants",
  metricStaked: "Staked",

  stepAtoms: "Terms",
  stepTriples: "Claims",
  gasFees: "Network fees",
  mainTripleOnchain: "This claim already exists",
  emptyPlan: "Add at least one claim to preview.",
  depositsConfirmed: "Support confirmed",
  costHint: "Trust is refundable when others support your claims. Network fees are non-refundable.",

  dialogStepPreview: "Preview & publish",

  composerTitleRoot: "New claim",
  composerHint: "Write one debatable idea. If needed, we\u2019ll split multiple ideas into separate posts.",

  originalTextLabel: "Your original text",
  previewIntroBody: "Review the cost below — trust is refundable when others support your claims.",

  protocolDetailsLabel: "Protocol details",
  successBody: "Your claims are now live.",
  successBodySingle: "Your claim is now live.",

  stanceSupports: "Supports",
  stanceRefutes: "Refutes",

  errorAtomCreation: "Failed to create terms.",
  errorTripleCreation: "Failed to create claims.",
  errorStanceCreation: "Unable to link your reply.",
  errorTagCreation: "Failed to tag claim with theme.",
  errorResolution: "Unable to verify claims.",
  errorDepositFailed: "Support failed.",
  preflightNoApproved: "Add at least one claim before publishing.",
  preflightNoMain: "Set at least one claim as primary before publishing.",

  splitAction: "Split into separate posts",
  mergeAll: "Merge into one post",
  nextDraft: "Next draft",
  draftHeaderPrefix: "Post",
  emptyDraftHint: "No claims — this post will be ignored.",

  bodyPlaceholder: "This text will be published as your post.",
  bodyReset: "Reset",

  nestedStepLabel: "Context",
  errorNestedCreation: "Failed to create context claims.",

  nestedEdgeListTitle: "Detected context",
  nestedEdgeListSubtitle: "Context detected by the assistant. You can validate or reject each item in the next step.",

  splitNoticeTitle: "Your text was split into {count} posts",
  splitNoticeBody: "Each post focuses on a single debatable claim, making it easier for others to respond.",

  stanceWarningPrefix: "Stance mismatch:",

  rejectionOffTopic: "Your text doesn't seem related to this debate. Make sure you're replying to the right claim.",
  rejectionNotDebatable: "This doesn't contain a debatable argument. Try rephrasing as a clear claim.",
  rejectionGibberish: "We couldn't understand your text. Please write a clear argument.",
  rejectionNoMainClaims: "No main claims could be extracted. Try making your argument more explicit.",
  rejectionNoNewInformation: "Your reply does not add new information relative to the parent claim.",
  rejectionLlmUnavailable: "The AI service is temporarily busy. Please wait a moment and try again.",
  rejectionExtractionFailed: "Something went wrong during analysis. Please try again.",

  refineChatOpen: "Refine with AI",
  refineChatClose: "Hide chat",

  publishedClaimsLabel: "Claims",
  metadataLabel: "Metadata",
  conservativeEstimateHint: "Conservative estimate — some existing claims may be detected at publish time, reducing costs.",

  useAsNewTerm: "Use as new term",

  publishExplainer: "These structured claims connect your post to related debates and reusable ideas.",
  publishSuccessCta: "Explore connected ideas",

  connectWalletToPublish: "Connect your wallet to publish.",
  connectWalletToAnalyze: "Connect your wallet to analyze.",
  wrongNetworkWarning: "Wrong network.",
  switchNetworkButton: "Switch network",
  contentChangedWarning: "Content changed — re-extract to publish.",
  publishingStatus: "Publishing...",
  analyzingStatus: "Analyzing...",
} as const;
