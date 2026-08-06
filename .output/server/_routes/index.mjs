import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { i as defineEventHandler } from "../_libs/h3+rou3+srvx.mjs";
import { n as setPublicApiHeaders } from "../_chunks/http.mjs";
//#region server/routes/index.get.ts
var index_get_default = defineEventHandler((event) => {
	setPublicApiHeaders(event, "public, max-age=300, s-maxage=3600");
	return {
		name: "TeleMLEBench backend",
		frontend: "https://mrantons.github.io/TeleMLEBench/",
		api: "/api/v1",
		openapi: "/api/v1/openapi.json"
	};
});
//#endregion
export { index_get_default as default };
