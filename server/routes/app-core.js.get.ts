import { defineEventHandler, setHeader } from "nitro/h3";

import appSource from "../../app.js?raw";

export default defineEventHandler((event) => {
  setHeader(event, "Cache-Control", "public, max-age=300, s-maxage=3600");
  setHeader(event, "Content-Type", "text/javascript; charset=utf-8");
  setHeader(event, "X-Content-Type-Options", "nosniff");
  return appSource;
});
