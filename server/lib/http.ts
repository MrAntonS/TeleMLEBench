import { setHeader, type H3Event } from "nitro/h3";

export function setPublicApiHeaders(event: H3Event, cacheControl = "public, max-age=60, s-maxage=3600"): void {
  setHeader(event, "Access-Control-Allow-Origin", "*");
  setHeader(event, "Cache-Control", cacheControl);
  setHeader(event, "X-Content-Type-Options", "nosniff");
}

export function setPrivateApiHeaders(event: H3Event): void {
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "Referrer-Policy", "no-referrer");
  setHeader(event, "X-Content-Type-Options", "nosniff");
}
