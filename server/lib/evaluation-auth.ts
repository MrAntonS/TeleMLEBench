import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { createError, getHeader, type H3Event } from "nitro/h3";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type EvaluationPrincipal = {
  keyDigest: string;
  fingerprint: string;
};

function configuredDigests(): Buffer[] {
  return String(process.env.TMLB_EVALUATION_API_KEY_SHA256S || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => SHA256_PATTERN.test(value))
    .map((value) => Buffer.from(value, "hex"));
}

function bearerToken(event: H3Event): string {
  const authorization = String(getHeader(event, "authorization") || "");
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : "";
}

export function requireEvaluationPrincipal(event: H3Event): EvaluationPrincipal {
  const accepted = configuredDigests();
  if (!accepted.length) {
    throw createError({
      statusCode: 503,
      statusMessage: "Evaluation authentication is not configured",
    });
  }
  const token = bearerToken(event);
  if (!token || token.length > 512) {
    throw createError({ statusCode: 401, statusMessage: "A valid evaluation API key is required" });
  }
  const digest = createHash("sha256").update(token, "utf8").digest();
  let matched = false;
  for (const candidate of accepted) {
    matched = timingSafeEqual(candidate, digest) || matched;
  }
  if (!matched) {
    throw createError({ statusCode: 401, statusMessage: "A valid evaluation API key is required" });
  }
  const keyDigest = digest.toString("hex");
  return { keyDigest, fingerprint: keyDigest.slice(0, 12) };
}

function runSignature(runId: string, keyDigest: string): string {
  return createHmac("sha256", Buffer.from(keyDigest, "hex"))
    .update(runId, "utf8")
    .digest("base64url")
    .slice(0, 24);
}

export function externalEvaluationId(runId: string, principal: EvaluationPrincipal): string {
  return `${runId}.${runSignature(runId, principal.keyDigest)}`;
}

export function internalRunId(
  evaluationId: string,
  principal: EvaluationPrincipal,
): string | null {
  const separator = evaluationId.lastIndexOf(".");
  if (separator <= 0) return null;
  const runId = evaluationId.slice(0, separator);
  const supplied = evaluationId.slice(separator + 1);
  const expected = runSignature(runId, principal.keyDigest);
  if (supplied.length !== expected.length) return null;
  const valid = timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  return valid ? runId : null;
}
