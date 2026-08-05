import { head, put } from "@vercel/blob";
import { createError, defineEventHandler, readBody, setResponseStatus } from "nitro/h3";
import { start } from "workflow/api";

import { externalEvaluationId, requireEvaluationPrincipal } from "../../../lib/evaluation-auth";
import {
  claimEvaluationGrant,
  EvaluationGrantAlreadyClaimedError,
} from "../../../lib/evaluation-claim.mjs";
import { setPrivateApiHeaders } from "../../../lib/http";
import { isPredictionPath } from "../../../lib/prediction-path";
import { getReleaseDescriptor } from "../../../lib/releases";
import { scorePredictionsWorkflow } from "../../../../workflows/score-predictions";

type EvaluationRequest = {
  release_id?: unknown;
  prediction?: {
    pathname?: unknown;
    size?: unknown;
  };
};

export default defineEventHandler(async (event) => {
  setPrivateApiHeaders(event);
  const body = await readBody<EvaluationRequest>(event);
  const releaseId = String(body?.release_id || "");
  const pathname = String(body?.prediction?.pathname || "");
  const size = Number(body?.prediction?.size);
  const descriptor = getReleaseDescriptor(releaseId);
  if (!descriptor || descriptor.metric !== "accuracy") {
    throw createError({ statusCode: 409, statusMessage: "This release has no supervised evaluator" });
  }
  if (!isPredictionPath(releaseId, pathname) || !Number.isSafeInteger(size) ||
      size <= 0 || size > descriptor.maximumPredictionBytes) {
    throw createError({ statusCode: 400, statusMessage: "Invalid prediction upload metadata" });
  }
  const principal = requireEvaluationPrincipal(event, { releaseId, pathname });
  let metadata;
  try {
    metadata = await head(pathname);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Private prediction upload was not found" });
  }
  if (metadata.pathname !== pathname || metadata.size !== size) {
    throw createError({ statusCode: 400, statusMessage: "Private prediction upload metadata does not match" });
  }
  if (principal.kind === "captcha_grant") {
    try {
      await claimEvaluationGrant(principal.grantId, put);
    } catch (error) {
      if (error instanceof EvaluationGrantAlreadyClaimedError) {
        throw createError({ statusCode: 409, statusMessage: "This browser evaluation grant was already used" });
      }
      throw createError({ statusCode: 503, statusMessage: "Evaluation replay protection is temporarily unavailable" });
    }
  }
  const run = await start(scorePredictionsWorkflow, [{
    releaseId,
    predictionPath: pathname,
    predictionSize: size,
    requesterFingerprint: principal.fingerprint,
  }]);
  const evaluationId = externalEvaluationId(run.runId, principal);
  setResponseStatus(event, 202);
  return {
    evaluation_id: evaluationId,
    release_id: releaseId,
    status: "queued",
    status_endpoint: `/api/v1/evaluations/${encodeURIComponent(evaluationId)}`,
  };
});
