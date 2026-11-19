import {
  createError,
  defineEventHandler,
  getRouterParam,
  sendRedirect,
  setHeader,
} from "nitro/h3";

import { releaseAssets } from "../../../../../lib/release-assets";
import {
  fetchRawManifest,
  getReleaseDescriptor,
  normalizePublicManifest,
  publicArtifactUrl,
  publicFileByRole,
  taskFileText,
} from "../../../../../lib/releases";

const DATA_ROLES = new Set(["train", "validation", "test_features", "val", "test"]);

export default defineEventHandler(async (event) => {
  const releaseId = String(getRouterParam(event, "releaseId") || "");
  const role = String(getRouterParam(event, "role") || "");
  const descriptor = getReleaseDescriptor(releaseId);
  if (!descriptor) throw createError({ statusCode: 404, statusMessage: "Release not found" });
  if (descriptor.distribution === "provider_only" && DATA_ROLES.has(role)) {
    // OWL does not redistribute this dataset: no redirect, no bytes.
    throw createError({
      statusCode: 410,
      statusMessage: "OWL does not redistribute this dataset",
      data: {
        code: "provider_only",
        provider_url: descriptor.providerUrl,
        build_script: `/api/v1/releases/${encodeURIComponent(releaseId)}/files/build_script`,
        task: `/api/v1/releases/${encodeURIComponent(releaseId)}/files/task`,
      },
    });
  }
  let raw;
  let release;
  try {
    raw = await fetchRawManifest(descriptor);
    release = normalizePublicManifest(descriptor, raw, releaseAssets);
  } catch {
    throw createError({ statusCode: 502, statusMessage: "Published manifest is temporarily unavailable" });
  }
  const file = publicFileByRole(release, role);
  if (!file) throw createError({ statusCode: 404, statusMessage: "Release file role not found" });
  setHeader(event, "Cache-Control", "public, max-age=300, s-maxage=86400");
  setHeader(event, "Access-Control-Allow-Origin", "*");
  setHeader(event, "X-TeleMLEBench-SHA256", file.sha256);
  if (file.role === "task") {
    setHeader(event, "Content-Type", "application/json; charset=utf-8");
    setHeader(event, "Content-Disposition", 'attachment; filename="task.json"');
    return taskFileText(descriptor, raw);
  }
  if (file.role === "build_script") {
    setHeader(event, "Content-Type", "text/x-python; charset=utf-8");
    setHeader(event, "Content-Disposition", 'attachment; filename="build_split.py"');
    return releaseAssets.buildScript;
  }
  setHeader(event, "Cache-Control", "public, max-age=300, s-maxage=86400, immutable");
  return sendRedirect(event, publicArtifactUrl(releaseId, file.logical_path), 307);
});
