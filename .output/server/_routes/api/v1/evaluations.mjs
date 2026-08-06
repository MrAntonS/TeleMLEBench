import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { f as readBody, h as setResponseStatus, i as defineEventHandler, r as createError } from "../../../_libs/h3+rou3+srvx.mjs";
import { i as start } from "../../../_libs/@workflow/core+[...].mjs";
import { a as put, i as head } from "../../../_libs/@vercel/blob+[...].mjs";
import "../../../_libs/workflow.mjs";
import { r as getReleaseDescriptor } from "../../../_chunks/releases.mjs";
import { t as isPredictionPath } from "../../../index.mjs";
import { i as requireEvaluationPrincipal, t as externalEvaluationId } from "../../../_chunks/evaluation-auth.mjs";
import { t as setPrivateApiHeaders } from "../../../_chunks/http.mjs";
import { createHash } from "node:crypto";
//#region server/lib/evaluation-claim.mjs
var EvaluationGrantAlreadyClaimedError = class extends Error {};
function evaluationGrantClaimPath(grantId) {
	const value = String(grantId || "");
	if (!value || value.length > 256) throw new Error("A valid evaluation grant ID is required");
	return "evaluation-grants/" + createHash("sha256").update(value, "utf8").digest("hex") + ".claim";
}
async function claimEvaluationGrant(grantId, putImpl) {
	const pathname = evaluationGrantClaimPath(grantId);
	try {
		await putImpl(pathname, "claimed", {
			access: "private",
			addRandomSuffix: false,
			allowOverwrite: false,
			cacheControlMaxAge: 60,
			contentType: "text/plain"
		});
	} catch (error) {
		if (error?.name === "BlobPreconditionFailedError") throw new EvaluationGrantAlreadyClaimedError("Evaluation grant was already used");
		throw error;
	}
	return pathname;
}
//#endregion
//#region workflows/score-predictions/index.ts
async function scorePredictionsWorkflow(input) {
	throw new Error("You attempted to execute workflow scorePredictionsWorkflow function directly. To start a workflow, use start(scorePredictionsWorkflow) from workflow/api");
}
scorePredictionsWorkflow.workflowId = "workflow//./workflows/score-predictions/index//scorePredictionsWorkflow";
//#endregion
//#region server/api/v1/evaluations/index.post.ts
var index_post_default = defineEventHandler(async (event) => {
	setPrivateApiHeaders(event);
	const body = await readBody(event);
	const releaseId = String(body?.release_id || "");
	const pathname = String(body?.prediction?.pathname || "");
	const size = Number(body?.prediction?.size);
	const descriptor = getReleaseDescriptor(releaseId);
	if (!descriptor || descriptor.metric !== "accuracy") throw createError({
		statusCode: 409,
		statusMessage: "This release has no supervised evaluator"
	});
	if (!isPredictionPath(releaseId, pathname) || !Number.isSafeInteger(size) || size <= 0 || size > descriptor.maximumPredictionBytes) throw createError({
		statusCode: 400,
		statusMessage: "Invalid prediction upload metadata"
	});
	const principal = requireEvaluationPrincipal(event, {
		releaseId,
		pathname
	});
	let metadata;
	try {
		metadata = await head(pathname);
	} catch {
		throw createError({
			statusCode: 400,
			statusMessage: "Private prediction upload was not found"
		});
	}
	if (metadata.pathname !== pathname || metadata.size !== size) throw createError({
		statusCode: 400,
		statusMessage: "Private prediction upload metadata does not match"
	});
	if (principal.kind === "captcha_grant") try {
		await claimEvaluationGrant(principal.grantId, put);
	} catch (error) {
		if (error instanceof EvaluationGrantAlreadyClaimedError) throw createError({
			statusCode: 409,
			statusMessage: "This browser evaluation grant was already used"
		});
		throw createError({
			statusCode: 503,
			statusMessage: "Evaluation replay protection is temporarily unavailable"
		});
	}
	const run = await start(scorePredictionsWorkflow, [{
		releaseId,
		predictionPath: pathname,
		predictionSize: size,
		requesterFingerprint: principal.fingerprint
	}]);
	const evaluationId = externalEvaluationId(run.runId, principal);
	setResponseStatus(event, 202);
	return {
		evaluation_id: evaluationId,
		release_id: releaseId,
		status: "queued",
		status_endpoint: `/api/v1/evaluations/${encodeURIComponent(evaluationId)}`
	};
});
//#endregion
export { index_post_default as default };
