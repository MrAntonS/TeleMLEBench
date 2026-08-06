import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { d as getRouterParam, h as setResponseStatus, i as defineEventHandler, r as createError } from "./_libs/h3+rou3+srvx.mjs";
import { r as getRun } from "./_libs/@workflow/core+[...].mjs";
import "./_libs/workflow.mjs";
import { i as requireEvaluationPrincipal, n as internalRunId } from "./_chunks/evaluation-auth.mjs";
import { t as setPrivateApiHeaders } from "./_chunks/http.mjs";
//#region server/api/v1/evaluations/[evaluationId].get.ts
var _evaluationId__get_default = defineEventHandler(async (event) => {
	setPrivateApiHeaders(event);
	const principal = requireEvaluationPrincipal(event);
	const evaluationId = String(getRouterParam(event, "evaluationId") || "");
	const runId = internalRunId(evaluationId, principal);
	if (!runId) throw createError({
		statusCode: 404,
		statusMessage: "Evaluation not found"
	});
	const run = getRun(runId);
	if (!await run.exists) throw createError({
		statusCode: 404,
		statusMessage: "Evaluation not found"
	});
	const status = await run.status;
	if (status === "completed") return {
		evaluation_id: evaluationId,
		status,
		result: await run.returnValue
	};
	if (status === "failed") return {
		evaluation_id: evaluationId,
		status,
		error: {
			code: "workflow_failed",
			message: "The durable evaluator failed before producing a result."
		}
	};
	setResponseStatus(event, 202);
	return {
		evaluation_id: evaluationId,
		status
	};
});
//#endregion
export { _evaluationId__get_default as default };
