import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { f as readBody, i as defineEventHandler, r as createError } from "../../../../_libs/h3+rou3+srvx.mjs";
import { t as handleUpload } from "../../../../_libs/@vercel/blob+[...].mjs";
import { r as getReleaseDescriptor } from "../../../../_chunks/releases.mjs";
import { t as isPredictionPath } from "../../../../index.mjs";
import { n as isEvaluationGrantSecretConfigured, r as issueEvaluationGrant } from "../../../../_chunks/evaluation-grants.mjs";
import { r as optionalEvaluationApiPrincipal } from "../../../../_chunks/evaluation-auth.mjs";
import { t as setPrivateApiHeaders } from "../../../../_chunks/http.mjs";
import { createHash } from "node:crypto";
//#region server/lib/turnstile.mjs
var SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
var TurnstileConfigurationError = class extends Error {};
var TurnstileUnavailableError = class extends Error {};
/**
* @param {string} token
* @param {{
*   secret?: string,
*   expectedHostname?: string,
*   expectedAction?: string,
*   remoteIp?: string,
*   fetchImpl?: typeof fetch,
*   timeoutMs?: number
* }} [options]
*/
async function verifyTurnstileToken(token, { secret, expectedHostname, expectedAction = "evaluation_upload", remoteIp, fetchImpl = fetch, timeoutMs = 8e3 } = {}) {
	const responseToken = String(token || "");
	const secretKey = String(secret || "");
	const hostname = String(expectedHostname || "").toLowerCase();
	if (!secretKey || !hostname) throw new TurnstileConfigurationError("Turnstile is not configured");
	if (!responseToken || responseToken.length > 2048) return {
		success: false,
		code: "invalid-input-response"
	};
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let response;
	try {
		response = await fetchImpl(SITEVERIFY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				secret: secretKey,
				response: responseToken,
				...remoteIp ? { remoteip: String(remoteIp) } : {}
			}),
			signal: controller.signal
		});
	} catch (error) {
		throw new TurnstileUnavailableError(error?.name === "AbortError" ? "Turnstile verification timed out" : "Turnstile verification is unavailable");
	} finally {
		clearTimeout(timer);
	}
	if (!response.ok) throw new TurnstileUnavailableError("Turnstile verification is unavailable");
	let result;
	try {
		result = await response.json();
	} catch {
		throw new TurnstileUnavailableError("Turnstile returned an invalid response");
	}
	if (result?.success !== true) {
		const codes = Array.isArray(result?.["error-codes"]) ? result["error-codes"] : [];
		return {
			success: false,
			code: String(codes[0] || "challenge-failed")
		};
	}
	if (String(result.hostname || "").toLowerCase() !== hostname) return {
		success: false,
		code: "hostname-mismatch"
	};
	if (String(result.action || "") !== String(expectedAction)) return {
		success: false,
		code: "action-mismatch"
	};
	return {
		success: true,
		hostname: String(result.hostname),
		action: String(result.action),
		challengeTimestamp: String(result.challenge_ts || "")
	};
}
//#endregion
//#region server/api/v1/evaluations/uploads.post.ts
var uploads_post_default = defineEventHandler(async (event) => {
	setPrivateApiHeaders(event);
	const body = await readBody(event);
	if (!body) throw createError({
		statusCode: 400,
		statusMessage: "Invalid upload request"
	});
	let evaluationToken = "";
	const result = await handleUpload({
		request: event.req,
		body,
		onBeforeGenerateToken: async (pathname, clientPayload) => {
			let releaseId = "";
			let turnstileToken = "";
			try {
				const parsed = JSON.parse(String(clientPayload || "{}"));
				releaseId = String(parsed.release_id || "");
				turnstileToken = String(parsed.turnstile_token || "");
			} catch {
				throw createError({
					statusCode: 400,
					statusMessage: "Invalid upload metadata"
				});
			}
			const descriptor = getReleaseDescriptor(releaseId);
			if (!descriptor || descriptor.metric !== "accuracy" || !isPredictionPath(releaseId, pathname)) throw createError({
				statusCode: 400,
				statusMessage: "Invalid evaluation upload path"
			});
			let principal = optionalEvaluationApiPrincipal(event);
			if (!principal) {
				const grantSecret = String(process.env.TMLB_EVALUATION_GRANT_SECRET || "");
				if (!isEvaluationGrantSecretConfigured(grantSecret)) throw createError({
					statusCode: 503,
					statusMessage: "Human verification is not configured"
				});
				try {
					if (!(await verifyTurnstileToken(turnstileToken, {
						secret: process.env.TURNSTILE_SECRET_KEY,
						expectedHostname: process.env.TURNSTILE_EXPECTED_HOSTNAME,
						expectedAction: "evaluation_upload"
					})).success) throw createError({
						statusCode: 403,
						statusMessage: "Human verification failed; retry the challenge"
					});
					evaluationToken = issueEvaluationGrant({
						releaseId,
						pathname
					}, grantSecret);
					const digest = createHash("sha256").update(evaluationToken, "utf8").digest("hex");
					principal = {
						keyDigest: digest,
						fingerprint: "captcha:" + digest.slice(0, 12),
						kind: "captcha_grant"
					};
				} catch (error) {
					if (error instanceof TurnstileConfigurationError) throw createError({
						statusCode: 503,
						statusMessage: "Human verification is not configured"
					});
					if (error instanceof TurnstileUnavailableError) throw createError({
						statusCode: 503,
						statusMessage: "Human verification is temporarily unavailable"
					});
					throw error;
				}
			}
			return {
				allowedContentTypes: [
					"text/csv",
					"application/csv",
					"application/gzip",
					"application/x-gzip",
					"application/octet-stream"
				],
				maximumSizeInBytes: descriptor.maximumPredictionBytes,
				validUntil: Date.now() + 6e5,
				addRandomSuffix: false,
				allowOverwrite: false,
				cacheControlMaxAge: 60,
				tokenPayload: JSON.stringify({
					release_id: releaseId,
					requester: principal.fingerprint
				})
			};
		}
	});
	return evaluationToken ? {
		...result,
		evaluationToken
	} : result;
});
//#endregion
export { uploads_post_default as default };
