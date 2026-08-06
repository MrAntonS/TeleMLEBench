import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { d as getRouterParam, i as defineEventHandler, r as createError } from "../../../../../_libs/h3+rou3+srvx.mjs";
import { n as fetchPublicRelease, r as getReleaseDescriptor } from "../../../../../_chunks/releases.mjs";
import { n as setPublicApiHeaders } from "../../../../../_chunks/http.mjs";
//#region server/api/v1/releases/[releaseId]/manifest.get.ts
var manifest_get_default = defineEventHandler(async (event) => {
	setPublicApiHeaders(event, "public, max-age=300, s-maxage=86400, immutable");
	const releaseId = String(getRouterParam(event, "releaseId") || "");
	const descriptor = getReleaseDescriptor(releaseId);
	if (!descriptor) throw createError({
		statusCode: 404,
		statusMessage: "Release not found"
	});
	try {
		return await fetchPublicRelease(descriptor);
	} catch {
		throw createError({
			statusCode: 502,
			statusMessage: "Published manifest is temporarily unavailable"
		});
	}
});
//#endregion
export { manifest_get_default as default };
