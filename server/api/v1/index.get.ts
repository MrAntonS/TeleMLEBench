import { defineEventHandler } from "nitro/h3";

import { setPublicApiHeaders } from "../../lib/http";

export default defineEventHandler((event) => {
  setPublicApiHeaders(event);
  return {
    name: "TeleMLEBench release and evaluation API",
    version: "1.0.0",
    openapi: "/api/v1/openapi.json",
    releases: "/api/v1/releases",
    evaluation_upload_protocol: "/api/v1/evaluations/uploads",
    evaluation_start: "/api/v1/evaluations",
  };
});
