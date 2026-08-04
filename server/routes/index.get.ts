import { defineEventHandler } from "nitro/h3";

import { setPublicApiHeaders } from "../lib/http";

export default defineEventHandler((event) => {
  setPublicApiHeaders(event, "public, max-age=300, s-maxage=3600");
  return {
    name: "TeleMLEBench backend",
    frontend: "https://mrantons.github.io/TeleMLEBench/",
    api: "/api/v1",
    openapi: "/api/v1/openapi.json",
  };
});
