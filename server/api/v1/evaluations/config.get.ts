import { defineEventHandler } from "nitro/h3";

import { setPublicApiHeaders } from "../../../lib/http";
import { isEvaluationGrantSecretConfigured } from "../../../lib/evaluation-grants.mjs";

export default defineEventHandler((event) => {
  setPublicApiHeaders(event, "public, max-age=60, s-maxage=300");
  const siteKey = String(process.env.TURNSTILE_SITE_KEY || "");
  const enabled = Boolean(
    siteKey &&
    process.env.TURNSTILE_SECRET_KEY &&
    process.env.TURNSTILE_EXPECTED_HOSTNAME &&
    isEvaluationGrantSecretConfigured(process.env.TMLB_EVALUATION_GRANT_SECRET)
  );
  return {
    enabled,
    turnstile_site_key: enabled ? siteKey : "",
    action: "evaluation_upload",
  };
});
