/**
 * Errors an API caller sees.
 *
 * Separate from `CalcError` because they answer a different question. A
 * `CalcError` says the *calculation* is wrong and points at a span; an
 * `ApiError` says the *request* is wrong and points at an operation. A caller
 * fixing its own patch needs to know which of those happened without parsing
 * prose.
 */

export type ApiErrorCode =
  | "unknown_region"
  | "unknown_name"
  | "invalid_patch"
  | "duplicate_id"
  | "wrong_kind"
  | "invalid_value";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    /** Index into the submitted operation list, when there was one. */
    readonly operation?: number,
    readonly region?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toJSON(): {
    code: ApiErrorCode;
    message: string;
    operation?: number;
    region?: string;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.operation !== undefined ? { operation: this.operation } : {}),
      ...(this.region !== undefined ? { region: this.region } : {}),
    };
  }
}
