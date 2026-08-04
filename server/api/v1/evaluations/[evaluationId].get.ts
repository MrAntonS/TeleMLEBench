import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
} from "nitro/h3";
import { getRun } from "workflow/api";

import {
  internalRunId,
  requireEvaluationPrincipal,
} from "../../../lib/evaluation-auth";
import { setPrivateApiHeaders } from "../../../lib/http";

export default defineEventHandler(async (event) => {
  setPrivateApiHeaders(event);
  const principal = requireEvaluationPrincipal(event);
  const evaluationId = String(getRouterParam(event, "evaluationId") || "");
  const runId = internalRunId(evaluationId, principal);
  if (!runId) throw createError({ statusCode: 404, statusMessage: "Evaluation not found" });
  const run = getRun(runId);
  if (!(await run.exists)) {
    throw createError({ statusCode: 404, statusMessage: "Evaluation not found" });
  }
  const status = await run.status;
  if (status === "completed") {
    return {
      evaluation_id: evaluationId,
      status,
      result: await run.returnValue,
    };
  }
  if (status === "failed") {
    return {
      evaluation_id: evaluationId,
      status,
      error: {
        code: "workflow_failed",
        message: "The durable evaluator failed before producing a result.",
      },
    };
  }
  setResponseStatus(event, 202);
  return { evaluation_id: evaluationId, status };
});
