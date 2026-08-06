import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { i as defineEventHandler } from "../../../../_libs/h3+rou3+srvx.mjs";
import { n as isEvaluationGrantSecretConfigured } from "../../../../_chunks/evaluation-grants.mjs";
import { n as setPublicApiHeaders } from "../../../../_chunks/http.mjs";
//#region server/api/v1/evaluations/config.get.ts
var config_get_default = defineEventHandler((event) => {
	setPublicApiHeaders(event, "public, max-age=60, s-maxage=300");
	const siteKey = String(process.env.TURNSTILE_SITE_KEY || "");
	const enabled = Boolean(siteKey && process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_EXPECTED_HOSTNAME && isEvaluationGrantSecretConfigured(process.env.TMLB_EVALUATION_GRANT_SECRET));
	return {
		enabled,
		turnstile_site_key: enabled ? siteKey : "",
		action: "evaluation_upload"
	};
});
//#endregion
export { config_get_default as default };
