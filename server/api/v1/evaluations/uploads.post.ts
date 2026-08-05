import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { createHash } from "node:crypto";
import { createError, defineEventHandler, readBody } from "nitro/h3";

import { optionalEvaluationApiPrincipal } from "../../../lib/evaluation-auth";
import {
  isEvaluationGrantSecretConfigured,
  issueEvaluationGrant,
} from "../../../lib/evaluation-grants.mjs";
import { setPrivateApiHeaders } from "../../../lib/http";
import { isPredictionPath } from "../../../lib/prediction-path";
import { getReleaseDescriptor } from "../../../lib/releases";
import {
  TurnstileConfigurationError,
  TurnstileUnavailableError,
  verifyTurnstileToken,
} from "../../../lib/turnstile.mjs";

export default defineEventHandler(async (event) => {
  setPrivateApiHeaders(event);
  const body = await readBody<HandleUploadBody>(event);
  if (!body) {
    throw createError({ statusCode: 400, statusMessage: "Invalid upload request" });
  }
  let evaluationToken = "";
  const result = await handleUpload({
    request: event.req,
    body,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      let releaseId = "";
      let turnstileToken = "";
      try {
        const parsed = JSON.parse(String(clientPayload || "{}")) as {
          release_id?: unknown;
          turnstile_token?: unknown;
        };
        releaseId = String(parsed.release_id || "");
        turnstileToken = String(parsed.turnstile_token || "");
      } catch {
        throw createError({ statusCode: 400, statusMessage: "Invalid upload metadata" });
      }
      const descriptor = getReleaseDescriptor(releaseId);
      if (!descriptor || descriptor.metric !== "accuracy" || !isPredictionPath(releaseId, pathname)) {
        throw createError({ statusCode: 400, statusMessage: "Invalid evaluation upload path" });
      }
      let principal = optionalEvaluationApiPrincipal(event);
      if (!principal) {
        const grantSecret = String(process.env.TMLB_EVALUATION_GRANT_SECRET || "");
        if (!isEvaluationGrantSecretConfigured(grantSecret)) {
          throw createError({ statusCode: 503, statusMessage: "Human verification is not configured" });
        }
        try {
          const verified = await verifyTurnstileToken(turnstileToken, {
            secret: process.env.TURNSTILE_SECRET_KEY,
            expectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME,
            expectedAction: "evaluation_upload",
          });
          if (!verified.success) {
            throw createError({ statusCode: 403, statusMessage: "Human verification failed; retry the challenge" });
          }
          evaluationToken = issueEvaluationGrant(
            { releaseId, pathname },
            grantSecret,
          );
          const digest = createHash("sha256").update(evaluationToken, "utf8").digest("hex");
          principal = {
            keyDigest: digest,
            fingerprint: "captcha:" + digest.slice(0, 12),
            kind: "captcha_grant",
          };
        } catch (error) {
          if (error instanceof TurnstileConfigurationError) {
            throw createError({ statusCode: 503, statusMessage: "Human verification is not configured" });
          }
          if (error instanceof TurnstileUnavailableError) {
            throw createError({ statusCode: 503, statusMessage: "Human verification is temporarily unavailable" });
          }
          throw error;
        }
      }
      return {
        allowedContentTypes: [
          "text/csv",
          "application/csv",
          "application/gzip",
          "application/x-gzip",
          "application/octet-stream",
        ],
        maximumSizeInBytes: descriptor.maximumPredictionBytes,
        validUntil: Date.now() + 10 * 60 * 1000,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
        tokenPayload: JSON.stringify({
          release_id: releaseId,
          requester: principal.fingerprint,
        }),
      };
    },
  });
  return evaluationToken ? { ...result, evaluationToken } : result;
});
