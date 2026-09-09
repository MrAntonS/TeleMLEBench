import { put } from "@vercel/blob";
import { createError, defineEventHandler, readBody, setResponseStatus } from "nitro/h3";
import { getRun } from "workflow/api";

import {
  internalRunId,
  requireEvaluationPrincipal,
} from "../../../lib/evaluation-auth";
import { setPrivateApiHeaders } from "../../../lib/http";
import {
  buildPublicBaseline,
  publicBaselinePath,
} from "../../../lib/public-baselines.mjs";
import { getReleaseDescriptor } from "../../../lib/releases";

type PublicationRequest = {
  evaluation_id?: unknown;
  model?: {
    name?: unknown;
    recipe_version?: unknown;
    seed?: unknown;
    training?: unknown;
  };
};

export default defineEventHandler(async (event) => {
  setPrivateApiHeaders(event);
  const principal = requireEvaluationPrincipal(event);
  if (principal.kind !== "api_key") {
    throw createError({ statusCode: 403, statusMessage: "Only an operator API key can publish a baseline" });
  }
  const body = await readBody<PublicationRequest>(event);
  const evaluationId = String(body?.evaluation_id || "");
  const runId = internalRunId(evaluationId, principal);
  if (!runId) throw createError({ statusCode: 404, statusMessage: "Evaluation not found" });
  const run = getRun(runId);
  if (!(await run.exists) || await run.status !== "completed") {
    throw createError({ statusCode: 409, statusMessage: "The evaluation is not complete" });
  }
  const result = await run.returnValue;
  const descriptor = getReleaseDescriptor(String(result?.release_id || ""));
  if (!descriptor) throw createError({ statusCode: 409, statusMessage: "The evaluated release is not public" });

  let baseline;
  try {
    baseline = buildPublicBaseline({
      descriptor,
      evaluationId,
      result,
      model: {
        name: body?.model?.name,
        recipeVersion: body?.model?.recipe_version,
        seed: body?.model?.seed,
        training: body?.model?.training,
      },
      publishedAt: result.completed_at,
    });
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : "Invalid baseline publication request",
    });
  }

  await put(publicBaselinePath(descriptor.id), JSON.stringify(baseline), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
  setResponseStatus(event, 201);
  return {
    baseline,
    public_endpoint: `/api/v1/baselines?release_id=${encodeURIComponent(descriptor.id)}`,
  };
});
