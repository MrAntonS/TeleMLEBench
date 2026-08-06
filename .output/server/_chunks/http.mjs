import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { m as setHeader } from "../_libs/h3+rou3+srvx.mjs";
//#region server/lib/http.ts
function setPublicApiHeaders(event, cacheControl = "public, max-age=60, s-maxage=3600") {
	setHeader(event, "Access-Control-Allow-Origin", "*");
	setHeader(event, "Cache-Control", cacheControl);
	setHeader(event, "X-Content-Type-Options", "nosniff");
}
function setPrivateApiHeaders(event) {
	setHeader(event, "Cache-Control", "no-store");
	setHeader(event, "Referrer-Policy", "no-referrer");
	setHeader(event, "X-Content-Type-Options", "nosniff");
}
//#endregion
export { setPublicApiHeaders as n, setPrivateApiHeaders as t };
