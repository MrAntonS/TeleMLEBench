import { get } from "@vercel/blob";
import {
  createError,
  defineEventHandler,
  getRequestURL,
  getRouterParam,
  setHeader,
} from "nitro/h3";

import { setPublicApiHeaders } from "../../../../lib/http";
import { buildReplicateScript } from "../../../../lib/replicate-script.mjs";
import {
  parsePublicBaseline,
  publicBaselinePath,
  seededPublicBaseline,
} from "../../../../lib/public-baselines.mjs";
import {
  fetchPublicRelease,
  getReleaseDescriptor,
} from "../../../../lib/releases";

const PRODUCTION_API_BASE = "https://telemlebench.vercel.app/api/v1";

export default defineEventHandler(async (event) => {
  setPublicApiHeaders(event, "public, max-age=60, s-maxage=300");
  const releaseId = String(getRouterParam(event, "releaseId") || "");
  const descriptor = getReleaseDescriptor(releaseId);
  if (!descriptor) throw createError({ statusCode: 404, statusMessage: "Unknown release" });

  let baseline = null;
  try {
    const blob = await get(publicBaselinePath(descriptor.id), {
      access: "private",
      useCache: false,
    });
    if (blob && blob.statusCode === 200 && blob.stream) {
      const raw = await new Response(blob.stream as never).json();
      const parsed = parsePublicBaseline(raw);
      if (parsed?.release_id === descriptor.id) baseline = parsed;
    }
  } catch {
    baseline = null;
  }
  baseline = baseline || seededPublicBaseline(descriptor);
  if (!baseline) throw createError({ statusCode: 404, statusMessage: "No published baseline for this release" });

  let release = null;
  try {
    release = await fetchPublicRelease(descriptor);
  } catch {
    throw createError({ statusCode: 503, statusMessage: "The release manifest is temporarily unavailable" });
  }

  let apiBase = PRODUCTION_API_BASE;
  try {
    apiBase = new URL(getRequestURL(event)).origin + "/api/v1";
  } catch {
    apiBase = PRODUCTION_API_BASE;
  }

  let script: string;
  try {
    script = buildReplicateScript({ baseline, release, apiBase });
  } catch (error) {
    throw createError({
      statusCode: 409,
      statusMessage: error instanceof Error ? error.message : "This baseline cannot be replicated yet",
    });
  }
  setHeader(event, "Content-Type", "text/x-python; charset=utf-8");
  setHeader(event, "Content-Disposition", 'attachment; filename="main.py"');
  return script;
});
