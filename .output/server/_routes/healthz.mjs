import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { i as defineEventHandler } from "../_libs/h3+rou3+srvx.mjs";
//#region server/routes/healthz.get.ts
var healthz_get_default = defineEventHandler(() => ({ status: "ok" }));
//#endregion
export { healthz_get_default as default };
