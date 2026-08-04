import {
  defineEventHandler,
  getHeader,
  getMethod,
  getRequestURL,
  setHeader,
  setResponseStatus,
} from "nitro/h3";

const ALLOWED_ORIGINS = new Set([
  "https://mrantons.github.io",
]);

export default defineEventHandler((event) => {
  if (!getRequestURL(event).pathname.startsWith("/api/v1")) return;

  const origin = String(getHeader(event, "origin") || "");
  if (ALLOWED_ORIGINS.has(origin)) {
    setHeader(event, "Access-Control-Allow-Origin", origin);
    setHeader(event, "Vary", "Origin");
  }
  setHeader(event, "Access-Control-Allow-Headers", "Accept, Authorization, Content-Type");
  setHeader(event, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  setHeader(event, "Access-Control-Max-Age", "86400");

  if (getMethod(event) === "OPTIONS") {
    setResponseStatus(event, 204);
    return "";
  }
});
