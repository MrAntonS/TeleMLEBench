import {
  createError,
  defineEventHandler,
  getRouterParam,
  sendRedirect,
  setHeader,
} from "nitro/h3";

import { fetchPublicRelease, getReleaseDescriptor, publicArtifactUrl, publicFileByRole } from "../../../../../lib/releases";

export default defineEventHandler(async (event) => {
  const releaseId = String(getRouterParam(event, "releaseId") || "");
  const role = String(getRouterParam(event, "role") || "");
  const descriptor = getReleaseDescriptor(releaseId);
  if (!descriptor) throw createError({ statusCode: 404, statusMessage: "Release not found" });
  let release;
  try {
    release = await fetchPublicRelease(descriptor);
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Published manifest is temporarily unavailable" });
  }
  const file = publicFileByRole(release, role);
  if (!file) throw createError({ statusCode: 404, statusMessage: "Release file role not found" });
  setHeader(event, "Cache-Control", "public, max-age=300, s-maxage=86400, immutable");
  setHeader(event, "X-TeleMLEBench-SHA256", file.sha256);
  return sendRedirect(event, publicArtifactUrl(releaseId, file.logical_path), 307);
});
