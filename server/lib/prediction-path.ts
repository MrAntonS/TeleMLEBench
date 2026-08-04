import { getReleaseDescriptor } from "./releases";

const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function predictionPath(releaseId: string, uploadId: string, compressed: boolean): string {
  if (!getReleaseDescriptor(releaseId) || !UPLOAD_ID_PATTERN.test(uploadId)) {
    throw new Error("Invalid prediction upload path components");
  }
  return `evaluations/${releaseId}/${uploadId}/predictions.csv${compressed ? ".gz" : ""}`;
}

export function isPredictionPath(releaseId: string, pathname: string): boolean {
  if (!getReleaseDescriptor(releaseId)) return false;
  const prefix = `evaluations/${releaseId}/`;
  const remainder = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
  const separator = remainder.indexOf("/");
  if (separator < 0) return false;
  const uploadId = remainder.slice(0, separator);
  const filename = remainder.slice(separator + 1);
  return UPLOAD_ID_PATTERN.test(uploadId) &&
    (filename === "predictions.csv" || filename === "predictions.csv.gz");
}
