import { createError, defineEventHandler, getRouterParam } from "nitro/h3";

import { setPublicApiHeaders } from "../../../../lib/http";
import { fetchPublicRelease, getReleaseDescriptor } from "../../../../lib/releases";

export default defineEventHandler(async (event) => {
  setPublicApiHeaders(event, "public, max-age=300, s-maxage=86400, immutable");
  const releaseId = String(getRouterParam(event, "releaseId") || "");
  const descriptor = getReleaseDescriptor(releaseId);
  if (!descriptor) throw createError({ statusCode: 404, statusMessage: "Release not found" });
  try {
    return await fetchPublicRelease(descriptor);
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Published manifest is temporarily unavailable" });
  }
});
