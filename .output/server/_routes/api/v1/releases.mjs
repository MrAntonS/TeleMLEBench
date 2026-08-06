import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { i as defineEventHandler, l as getQuery } from "../../../_libs/h3+rou3+srvx.mjs";
import { i as listReleaseDescriptors, n as fetchPublicRelease } from "../../../_chunks/releases.mjs";
import { n as setPublicApiHeaders } from "../../../_chunks/http.mjs";
//#region server/api/v1/releases/index.get.ts
function matches(descriptor, filters) {
	const candidates = [
		descriptor.id,
		descriptor.datasetId,
		descriptor.datasetVersionId,
		...descriptor.aliases
	].map((value) => value.toLowerCase());
	return filters.every((filter) => candidates.includes(filter.toLowerCase()));
}
var index_get_default = defineEventHandler(async (event) => {
	setPublicApiHeaders(event);
	const query = getQuery(event);
	const filters = [
		query.dataset,
		query.dataset_id,
		query.dataset_version_id,
		query.release_id
	].map((value) => String(value || "").trim()).filter(Boolean);
	const descriptors = listReleaseDescriptors().filter((descriptor) => matches(descriptor, filters));
	const settled = await Promise.allSettled(descriptors.map((descriptor) => fetchPublicRelease(descriptor)));
	const items = [];
	const errors = [];
	settled.forEach((result, index) => {
		if (result.status === "fulfilled") items.push(result.value);
		else errors.push({
			release_id: descriptors[index].id,
			code: "manifest_unavailable"
		});
	});
	return {
		items,
		total: items.length,
		errors
	};
});
//#endregion
export { index_get_default as default };
