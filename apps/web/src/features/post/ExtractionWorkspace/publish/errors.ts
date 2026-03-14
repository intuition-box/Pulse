export type PublishPipelineCode =
  | "MAIN_REF_MISSING"
  | "PARENT_REF_MISSING"
  | "METADATA_UNRESOLVED"
  | "hydrate_failed"
  | "atom_resolution_failed"
  | "atom_creation_failed"
  | "triple_resolution_failed"
  | "triple_creation_failed"
  | "nested_resolution_failed"
  | "nested_creation_failed"
  | "stance_failed"
  | "deposit_failed"
  | "resolution_incomplete"
  | "relevance_check_failed";

export class PublishPipelineError extends Error {
  code: PublishPipelineCode;
  constructor(code: PublishPipelineCode, message: string) {
    super(message);
    this.name = "PublishPipelineError";
    this.code = code;
  }
}

export function isUserReject(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("user rejected") || msg.includes("user denied") || msg.includes("rejected the request");
  }
  return false;
}

export function isInsufficientFunds(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("insufficient funds") || msg.includes("insufficient balance");
  }
  return false;
}

export function isNonRetryableError(err: unknown): boolean {
  return isUserReject(err) || isInsufficientFunds(err);
}
