import { defineEventHandler, getQuery } from "nitro/h3";

import { setPublicApiHeaders } from "../../../lib/http";
import {
  fetchPublicRelease,
  listReleaseDescriptors,
  type PublicRelease,
  type ReleaseDescriptor,
} from "../../../lib/releases";

function matches(descriptor: ReleaseDescriptor, filters: string[]): boolean {
  const candidates = [
    descriptor.id,
    descriptor.datasetId,
    descriptor.datasetVersionId,
    ...descriptor.aliases,
  ].map((value) => value.toLowerCase());
  return filters.every((filter) => candidates.includes(filter.toLowerCase()));
}

export default defineEventHandler(async (event) => {
  setPublicApiHeaders(event);
  const query = getQuery(event);
  const filters = [query.dataset, query.dataset_id, query.dataset_version_id, query.release_id]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const descriptors = listReleaseDescriptors().filter((descriptor) => matches(descriptor, filters));
  const settled = await Promise.allSettled(
    descriptors.map((descriptor) => fetchPublicRelease(descriptor)),
  );
  const items: PublicRelease[] = [];
  const errors: Array<{ release_id: string; code: "manifest_unavailable" }> = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(result.value);
    else errors.push({ release_id: descriptors[index].id, code: "manifest_unavailable" });
  });
  return { items, total: items.length, errors };
});
