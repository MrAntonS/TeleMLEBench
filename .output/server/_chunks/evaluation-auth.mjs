import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { r as createError, s as getHeader } from "../_libs/h3+rou3+srvx.mjs";
import { i as verifyEvaluationGrant } from "./evaluation-grants.mjs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
//#region server/lib/evaluation-auth.ts
var SHA256_PATTERN = /^[a-f0-9]{64}$/;
function configuredDigests() {
	return String(process.env.TMLB_EVALUATION_API_KEY_SHA256S || "").split(",").map((value) => value.trim().toLowerCase()).filter((value) => SHA256_PATTERN.test(value)).map((value) => Buffer.from(value, "hex"));
}
function bearerToken(event) {
	const match = String(getHeader(event, "authorization") || "").match(/^Bearer\s+([^\s]+)$/i);
	return match ? match[1] : "";
}
function requireApiKeyPrincipal(token) {
	const accepted = configuredDigests();
	if (!accepted.length) throw createError({
		statusCode: 503,
		statusMessage: "Evaluation authentication is not configured"
	});
	if (!token || token.length > 512) throw createError({
		statusCode: 401,
		statusMessage: "A valid evaluation API key is required"
	});
	const digest = createHash("sha256").update(token, "utf8").digest();
	let matched = false;
	for (const candidate of accepted) matched = timingSafeEqual(candidate, digest) || matched;
	if (!matched) throw createError({
		statusCode: 401,
		statusMessage: "A valid evaluation API key is required"
	});
	const keyDigest = digest.toString("hex");
	return {
		keyDigest,
		fingerprint: keyDigest.slice(0, 12),
		kind: "api_key"
	};
}
function optionalEvaluationApiPrincipal(event) {
	const token = bearerToken(event);
	if (!token) return null;
	if (token.startsWith("tmlb_eval_grant_v1.")) throw createError({
		statusCode: 401,
		statusMessage: "Use a fresh human-verification challenge for each upload"
	});
	return requireApiKeyPrincipal(token);
}
function requireEvaluationPrincipal(event, binding = {}) {
	const token = bearerToken(event);
	if (!token) throw createError({
		statusCode: 401,
		statusMessage: "A valid evaluation credential is required"
	});
	if (!token.startsWith("tmlb_eval_grant_v1.")) return requireApiKeyPrincipal(token);
	const secret = String(process.env.TMLB_EVALUATION_GRANT_SECRET || "");
	let payload;
	try {
		payload = verifyEvaluationGrant(token, binding, secret);
	} catch {
		throw createError({
			statusCode: 503,
			statusMessage: "Browser evaluation grants are not configured"
		});
	}
	if (!payload) throw createError({
		statusCode: 401,
		statusMessage: "The browser evaluation grant is invalid or expired"
	});
	return {
		keyDigest: createHash("sha256").update(token, "utf8").digest("hex"),
		fingerprint: "captcha:" + String(payload.jti).slice(0, 12),
		kind: "captcha_grant",
		grantId: String(payload.jti)
	};
}
function runSignature(runId, keyDigest) {
	return createHmac("sha256", Buffer.from(keyDigest, "hex")).update(runId, "utf8").digest("base64url").slice(0, 24);
}
function externalEvaluationId(runId, principal) {
	return `${runId}.${runSignature(runId, principal.keyDigest)}`;
}
function internalRunId(evaluationId, principal) {
	const separator = evaluationId.lastIndexOf(".");
	if (separator <= 0) return null;
	const runId = evaluationId.slice(0, separator);
	const supplied = evaluationId.slice(separator + 1);
	const expected = runSignature(runId, principal.keyDigest);
	if (supplied.length !== expected.length) return null;
	return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? runId : null;
}
//#endregion
export { requireEvaluationPrincipal as i, internalRunId as n, optionalEvaluationApiPrincipal as r, externalEvaluationId as t };
