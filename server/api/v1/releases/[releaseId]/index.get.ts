import { createError, defineEventHandler, getRouterParam } from "nitro/h3";

import { releaseAssets } from "../../../../lib/release-assets";
import { setPublicApiHeaders } from "../../../../lib/http";
import { fetchPublicRelease, getReleaseDescriptor } from "../../../../lib/releases";

export default defineEventHandler(async (event) => {
  setPublicApiHeaders(event);
  const releaseId = String(getRouterParam(event, "releaseId") || "");
  const descriptor = getReleaseDescriptor(releaseId);
  if (!descriptor) throw createError({ statusCode: 404, statusMessage: "Release not found" });
  try {
    return await fetchPublicRelease(descriptor, fetch, releaseAssets);
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Published manifest is temporarily unavailable" });
  }
});
