import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { i as defineEventHandler } from "../../_libs/h3+rou3+srvx.mjs";
import { n as setPublicApiHeaders } from "../../_chunks/http.mjs";
//#region server/api/v1/index.get.ts
var index_get_default = defineEventHandler((event) => {
	setPublicApiHeaders(event);
	return {
		name: "TeleMLEBench release and evaluation API",
		version: "1.0.0",
		openapi: "/api/v1/openapi.json",
		releases: "/api/v1/releases",
		evaluation_upload_protocol: "/api/v1/evaluations/uploads",
		evaluation_start: "/api/v1/evaluations"
	};
});
//#endregion
export { index_get_default as default };
