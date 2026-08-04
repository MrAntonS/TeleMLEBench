import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { createError, defineEventHandler, readBody } from "nitro/h3";

import { requireEvaluationPrincipal } from "../../../lib/evaluation-auth";
import { setPrivateApiHeaders } from "../../../lib/http";
import { isPredictionPath } from "../../../lib/prediction-path";
import { getReleaseDescriptor } from "../../../lib/releases";

export default defineEventHandler(async (event) => {
  setPrivateApiHeaders(event);
  const body = await readBody<HandleUploadBody>(event);
  return handleUpload({
    request: event.req,
    body,
    onBeforeGenerateToken: async (pathname, clientPayload) => {
      const principal = requireEvaluationPrincipal(event);
      let releaseId = "";
      try {
        const parsed = JSON.parse(String(clientPayload || "{}")) as { release_id?: unknown };
        releaseId = String(parsed.release_id || "");
      } catch {
        throw createError({ statusCode: 400, statusMessage: "Invalid upload metadata" });
      }
      const descriptor = getReleaseDescriptor(releaseId);
      if (!descriptor || descriptor.metric !== "accuracy" || !isPredictionPath(releaseId, pathname)) {
        throw createError({ statusCode: 400, statusMessage: "Invalid evaluation upload path" });
      }
      return {
        allowedContentTypes: [
          "text/csv",
          "application/csv",
          "application/gzip",
          "application/x-gzip",
          "application/octet-stream",
        ],
        maximumSizeInBytes: descriptor.maximumPredictionBytes,
        validUntil: Date.now() + 10 * 60 * 1000,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
        tokenPayload: JSON.stringify({
          release_id: releaseId,
          requester: principal.fingerprint,
        }),
      };
    },
  });
});
