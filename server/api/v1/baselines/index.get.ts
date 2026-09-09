import { get } from "@vercel/blob";
import { defineEventHandler, getQuery } from "nitro/h3";

import { setPublicApiHeaders } from "../../../lib/http";
import {
  parsePublicBaseline,
  publicBaselinePath,
  seededPublicBaseline,
} from "../../../lib/public-baselines.mjs";
import {
  listReleaseDescriptors,
  type ReleaseDescriptor,
} from "../../../lib/releases";

function matches(descriptor: ReleaseDescriptor, filters: string[]): boolean {
  const candidates = [
    descriptor.id,
    descriptor.datasetId,
    descriptor.datasetVersionId,
    descriptor.catalogSlug,
    ...descriptor.aliases,
  ].map((value) => value.toLowerCase());
  return filters.every((filter) => candidates.includes(filter.toLowerCase()));
}

async function storedBaseline(descriptor: ReleaseDescriptor) {
  try {
    const blob = await get(publicBaselinePath(descriptor.id), {
      access: "private",
      useCache: false,
    });
    if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
    const raw = await new Response(blob.stream as never).json();
    const parsed = parsePublicBaseline(raw);
    return parsed?.release_id === descriptor.id ? parsed : null;
  } catch {
    return null;
  }
}

export default defineEventHandler(async (event) => {
  setPublicApiHeaders(event);
  const query = getQuery(event);
  const filters = [query.dataset, query.dataset_id, query.dataset_version_id, query.release_id]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const descriptors = listReleaseDescriptors().filter((descriptor) => matches(descriptor, filters));
  const stored = await Promise.all(descriptors.map(storedBaseline));
  const items = descriptors.map((descriptor, index) =>
    stored[index] || seededPublicBaseline(descriptor)
  ).filter(Boolean);
  return { items, total: items.length };
});
