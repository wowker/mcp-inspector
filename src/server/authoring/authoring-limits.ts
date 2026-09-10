import { AUTHORING_LIMITS } from "../../shared/authoring/protocol.js";

export function authoringBoundedLimit(value: number | undefined, fallback: number,
  hardMaximum: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hardMaximum) {
    throw new Error(`${label} must be an integer between 1 and ${hardMaximum}`);
  }
  return resolved;
}

export const AUTHORING_HARD_LIMITS = Object.freeze({ ...AUTHORING_LIMITS });
