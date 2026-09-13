import { createHmac, timingSafeEqual } from "node:crypto";

export const SLACK_SIGNATURE_VERSION = "v0";
export const SLACK_TIMESTAMP_TOLERANCE_MS = 300_000;

export interface SlackSignatureInput {
  signingSecret: string;
  timestamp: string;
  signature: string;
  rawBody: string;
  now: number;
}

export function verifySlackSignature(input: SlackSignatureInput): boolean {
  if (input.signingSecret.trim() === "") return false;
  if (!/^\d+$/.test(input.timestamp)) return false;

  const timestampMs = Number(input.timestamp) * 1000;
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(input.now - timestampMs) > SLACK_TIMESTAMP_TOLERANCE_MS
  ) {
    return false;
  }

  const signatureBase = `${SLACK_SIGNATURE_VERSION}:${input.timestamp}:${input.rawBody}`;
  const expectedSignature = `${SLACK_SIGNATURE_VERSION}=${createHmac(
    "sha256",
    input.signingSecret,
  )
    .update(signatureBase)
    .digest("hex")}`;
  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(input.signature);

  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
