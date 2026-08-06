import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { d as getRouterParam, i as defineEventHandler, m as setHeader, p as sendRedirect, r as createError } from "./_libs/h3+rou3+srvx.mjs";
import { n as fetchPublicRelease, o as publicArtifactUrl, r as getReleaseDescriptor, s as publicFileByRole } from "./_chunks/releases.mjs";
//#region server/api/v1/releases/[releaseId]/files/[role].get.ts
var _role__get_default = defineEventHandler(async (event) => {
	const releaseId = String(getRouterParam(event, "releaseId") || "");
	const role = String(getRouterParam(event, "role") || "");
	const descriptor = getReleaseDescriptor(releaseId);
	if (!descriptor) throw createError({
		statusCode: 404,
		statusMessage: "Release not found"
	});
	let release;
	try {
		release = await fetchPublicRelease(descriptor);
	} catch {
		throw createError({
			statusCode: 502,
			statusMessage: "Published manifest is temporarily unavailable"
		});
	}
	const file = publicFileByRole(release, role);
	if (!file) throw createError({
		statusCode: 404,
		statusMessage: "Release file role not found"
	});
	setHeader(event, "Cache-Control", "public, max-age=300, s-maxage=86400, immutable");
	setHeader(event, "X-TeleMLEBench-SHA256", file.sha256);
	return sendRedirect(event, publicArtifactUrl(releaseId, file.logical_path), 307);
});
//#endregion
export { _role__get_default as default };
