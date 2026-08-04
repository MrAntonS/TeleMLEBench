import { defineEventHandler } from "nitro/h3";

import { setPublicApiHeaders } from "../../lib/http";
import { openApiDocument } from "../../lib/openapi";

export default defineEventHandler((event) => {
  setPublicApiHeaders(event, "public, max-age=300, s-maxage=86400");
  return openApiDocument;
});
