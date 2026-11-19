import { createHash } from "node:crypto";

export const PUBLIC_RELEASE_REPO = "NextGLab/telemlebench-releases";
export const PRIVATE_EVALUATOR_REPO = "NextGLab/telemlebench-evaluator";

// "mirrored": OWL serves the split files. "provider_only": OWL publishes only the split
// definition (assignments, task file, build script); users fetch the data from the provider.
export type Distribution = "mirrored" | "provider_only";

export type ReleaseLicense = {
  name: string;
  spdx: string | null;
  url: string | null;
  // Page on which the license (or the absence of one) was checked by hand.
  source_url: string;
  checked_on: string;
  redistribution: "allowed" | "not_allowed";
  attribution: string | null;
  terms: string | null;
};

export type ReleaseDescriptor = {
  id: string;
  datasetId: string;
  datasetVersionId: string;
  // tmlb_dataset_versions.id this release was cut from (the record the client and site read).
  catalogDatasetVersionId: string;
  catalogSlug: string;
  aliases: string[];
  metric: "accuracy" | null;
  maximumPredictionBytes: number;
  distribution: Distribution;
  providerUrl: string;
  license: ReleaseLicense;
  // Provider file names to show users when the snapshot path is content-addressed.
  sourceFileNames?: Record<string, string>;
};

export type PublicFileRole =
  | "train"
  | "validation"
  | "test_features"
  | "split_assignment"
  | "task"
  | "build_script";

export type PublicReleaseFile = {
  role: PublicFileRole;
  logical_path: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  download_endpoint: string;
};

export type ProviderSourceFile = { name: string; sha256: string; byte_size: number };

export type PublicRelease = {
  id: string;
  dataset_id: string;
  dataset_version_id: string;
  catalog_dataset_version_id: string;
  dataset_aliases: string[];
  task_id: string;
  release_version: string;
  status: "published";
  distribution: Distribution;
  provider_url: string;
  license: ReleaseLicense;
  algorithm_version: string;
  target_fields: string[];
  feature_count: number | null;
  split: {
    view: string;
    ratios: number[];
    seed: number;
    strategy: string;
    counts: { train: number; validation: number; test: number };
  };
  files: PublicReleaseFile[];
  source: { format: string; files: ProviderSourceFile[] } | null;
  manifest_endpoint: string;
  task_endpoint: string;
  evaluation: {
    available: boolean;
    metric: "accuracy" | null;
    expected_rows: number;
    prediction_columns: ["sample_id", "prediction"] | null;
    accepted_media_types: string[];
    maximum_upload_bytes: number;
    alignment: "sample_id_in_test_order" | null;
    score_publication: "private_result_only";
  };
};

type SplitManifest = {
  algorithm_version?: unknown;
  artifacts?: unknown;
  counts?: unknown;
  dataset_id?: unknown;
  dataset_version_id?: unknown;
  feature_count?: unknown;
  feature_fields?: unknown;
  sample_id_fields?: unknown;
  schema_version?: unknown;
  source_artifacts?: unknown;
  source_format?: unknown;
  source_members?: unknown;
  split?: unknown;
  target_fields?: unknown;
  task_id?: unknown;
};

type ManifestArtifact = {
  media_type?: unknown;
  path?: unknown;
  public?: unknown;
  role?: unknown;
  sha256?: unknown;
  size_bytes?: unknown;
};

const CC_BY = {
  name: "CC BY 4.0",
  spdx: "CC-BY-4.0",
  url: "https://creativecommons.org/licenses/by/4.0/",
  redistribution: "allowed",
  terms: null,
} as const;

function ccByAttribution(title: string, source: string): string {
  return `${title} (${source}), licensed under CC BY 4.0. OWL changes: re-split 70/15/15 (seed 42), ` +
    "added sample IDs, normalized column names and number formatting; test labels withheld for scoring.";
}

const RELEASES: readonly ReleaseDescriptor[] = [
  {
    id: "cicids2017-flow-classification-v1",
    datasetId: "tmleb:curated-url-https-www-unb-ca-cic-datasets-ids-2017-html-ce90b96ad6f7",
    datasetVersionId: "dsv_23647609e257911ae43693c0",
    catalogDatasetVersionId: "dsv_23647609e257911ae43693c0",
    catalogSlug: "curated-url-https-www-unb-ca-cic-datasets-ids-2017-html-ce90b96ad6f7",
    aliases: ["cicids2017", "cicids-2017", "curated-url-https-www-unb-ca-cic-datasets-ids-2017-html-ce90b96ad6f7"],
    metric: "accuracy",
    maximumPredictionBytes: 128 * 1024 * 1024,
    distribution: "provider_only",
    providerUrl: "https://www.unb.ca/cic/datasets/ids-2017.html",
    license: {
      name: "No license stated (UNB CIC terms)",
      spdx: null,
      url: null,
      source_url: "https://www.unb.ca/cic/datasets/ids-2017.html",
      checked_on: "2026-11-19",
      redistribution: "not_allowed",
      attribution: null,
      terms: "No license is stated. The provider describes the dataset as \"publicly available for researchers\" " +
        "and asks users to cite the dataset paper. © University of New Brunswick. OWL does not redistribute the data.",
    },
  },
  {
    id: "ciciot2023-attack-classification-v1",
    datasetId: "tmleb:curated-url-https-www-unb-ca-cic-datasets-iotdataset-2023-html-73dd07fac094",
    datasetVersionId: "dsv_a19618cffe36f58e6bb774fe",
    catalogDatasetVersionId: "dsv_a19618cffe36f58e6bb774fe",
    catalogSlug: "curated-url-https-www-unb-ca-cic-datasets-iotdataset-2023-html-73dd07fac094",
    aliases: ["ciciot2023", "cic-iot-2023", "curated-url-https-www-unb-ca-cic-datasets-iotdataset-2023-html-73dd07fac094"],
    metric: "accuracy",
    maximumPredictionBytes: 768 * 1024 * 1024,
    distribution: "provider_only",
    providerUrl: "https://www.unb.ca/cic/datasets/iotdataset-2023.html",
    license: {
      name: "No license stated (UNB CIC terms)",
      spdx: null,
      url: null,
      source_url: "https://www.unb.ca/cic/datasets/iotdataset-2023.html",
      checked_on: "2026-11-19",
      redistribution: "not_allowed",
      attribution: null,
      terms: "No license is stated. © University of New Brunswick; cite the dataset paper. " +
        "OWL does not redistribute the data.",
    },
  },
  {
    id: "n-baiot-attack-classification-v1",
    datasetId: "10.24432/c5rc8j",
    datasetVersionId: "dsv_d8d665aa98bc2aea62b619f4",
    catalogDatasetVersionId: "dsv_d8d665aa98bc2aea62b619f4",
    catalogSlug: "10-24432__c5rc8j",
    aliases: ["n-baiot", "nbaiot", "10-24432__c5rc8j"],
    metric: "accuracy",
    maximumPredictionBytes: 192 * 1024 * 1024,
    distribution: "mirrored",
    providerUrl: "https://archive.ics.uci.edu/dataset/442/detection+of+iot+botnet+attacks+n+baiot",
    license: {
      ...CC_BY,
      source_url: "https://archive.ics.uci.edu/dataset/442/detection+of+iot+botnet+attacks+n+baiot",
      checked_on: "catalog",
      attribution: ccByAttribution("N-BaIoT, UCI Machine Learning Repository", "https://doi.org/10.24432/C5RC8J"),
    },
  },
  {
    id: "radioml2016-10a-modulation-classification-v1",
    datasetId: "10.5281/zenodo.18397069",
    datasetVersionId: "dsv_765b73be81844f30db00ed66",
    catalogDatasetVersionId: "dsv_ebcdc40ddf743d67343b2440",
    catalogSlug: "radioml-2016-10a",
    aliases: ["radioml2016-10a", "radioml-2016.10a", "radioml-2016-10a"],
    metric: "accuracy",
    maximumPredictionBytes: 32 * 1024 * 1024,
    distribution: "mirrored",
    providerUrl: "https://www.deepsig.ai/datasets/",
    license: {
      name: "CC BY-NC-SA 4.0",
      spdx: "CC-BY-NC-SA-4.0",
      url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
      source_url: "https://www.deepsig.ai/datasets/",
      checked_on: "2026-11-19",
      redistribution: "allowed",
      attribution: "RadioML 2016.10A, DeepSig Inc. (https://www.deepsig.ai/datasets/), licensed under " +
        "CC BY-NC-SA 4.0. OWL changes: re-split 70/15/15 (seed 42), grouped into .npz files with sample IDs; " +
        "test labels withheld for scoring.",
      terms: "NonCommercial: you may not use this release for commercial purposes. ShareAlike: if you remix, " +
        "transform, or build upon it, you must distribute your contributions under CC BY-NC-SA 4.0.",
    },
  },
  {
    id: "topologybench-clustering-v1",
    datasetId: "10.5281/zenodo.12593794",
    datasetVersionId: "dsv_2b4b6c2f2f46033eaebd4f5e",
    catalogDatasetVersionId: "dsv_2b4b6c2f2f46033eaebd4f5e",
    catalogSlug: "10-5281__zenodo-13921775",
    aliases: ["topologybench", "10-5281__zenodo-13921775"],
    metric: null,
    maximumPredictionBytes: 0,
    distribution: "mirrored",
    providerUrl: "https://zenodo.org/records/13921775",
    license: {
      ...CC_BY,
      source_url: "https://doi.org/10.5281/zenodo.13921775",
      checked_on: "2026-11-19",
      attribution: ccByAttribution("TopologyBench, Zenodo", "https://doi.org/10.5281/zenodo.13921775"),
    },
  },
  {
    id: "ujindoorloc-floor-v1",
    datasetId: "10.24432/c5ms59",
    datasetVersionId: "dsv_10089411a0c5dbed537ad731",
    catalogDatasetVersionId: "dsv_10089411a0c5dbed537ad731",
    catalogSlug: "10-24432__c5ms59",
    aliases: ["ujindoorloc", "ujiindoorloc", "10-24432__c5ms59"],
    metric: "accuracy",
    maximumPredictionBytes: 16 * 1024 * 1024,
    distribution: "mirrored",
    providerUrl: "https://archive.ics.uci.edu/dataset/310/ujindoorloc",
    license: {
      ...CC_BY,
      source_url: "https://archive.ics.uci.edu/dataset/310/ujindoorloc",
      checked_on: "catalog",
      attribution: ccByAttribution("UJIIndoorLoc, UCI Machine Learning Repository", "https://doi.org/10.24432/C5MS59"),
    },
    sourceFileNames: {
      "893512b82dfd7a7c345d84195b1c8019fbca0fa0d7820ce491ce5aa45ec3782f": "ujiindoorloc.zip",
    },
  },
  {
    id: "veremi-extension-misbehavior-classification-v1",
    datasetId: "10.5281/zenodo.20090854",
    datasetVersionId: "dsv_b4b70c9e0abb5c1c91dc310f",
    catalogDatasetVersionId: "dsv_b4b70c9e0abb5c1c91dc310f",
    catalogSlug: "10-5281__zenodo-20090854",
    aliases: ["veremi-extension", "10-5281__zenodo-20090854"],
    metric: "accuracy",
    maximumPredictionBytes: 1024 * 1024 * 1024,
    distribution: "mirrored",
    providerUrl: "https://zenodo.org/records/20090854",
    license: {
      ...CC_BY,
      source_url: "https://veremi-dataset.github.io/veremi-extension/",
      checked_on: "2026-11-19",
      attribution: ccByAttribution("VeReMi Extension", "https://doi.org/10.5281/zenodo.20090854"),
    },
  },
  {
    id: "veremi-misbehavior-classification-v1",
    datasetId: "10.5281/zenodo.20081895",
    datasetVersionId: "dsv_a130fc2ac4a437717b45eb35",
    catalogDatasetVersionId: "dsv_a130fc2ac4a437717b45eb35",
    catalogSlug: "10-5281__zenodo-20081895",
    aliases: ["veremi", "10-5281__zenodo-20081895"],
    metric: "accuracy",
    maximumPredictionBytes: 512 * 1024 * 1024,
    distribution: "mirrored",
    providerUrl: "https://zenodo.org/records/20081895",
    license: {
      ...CC_BY,
      source_url: "https://veremi-dataset.github.io/veremi/",
      checked_on: "2026-11-19",
      attribution: ccByAttribution("VeReMi", "https://doi.org/10.5281/zenodo.20081895"),
    },
  },
  {
    id: "wisig-manysig-transmitter-classification-v1",
    datasetId: "tmleb:curated-url-https-cores-ee-ucla-edu-wisig-overview-206e82c51852",
    datasetVersionId: "dsv_ea3c9fdcb35dd7b1770c4281",
    catalogDatasetVersionId: "dsv_ea3c9fdcb35dd7b1770c4281",
    catalogSlug: "curated-url-https-cores-ee-ucla-edu-wisig-overview-206e82c51852",
    aliases: ["wisig", "wisig-manysig", "curated-url-https-cores-ee-ucla-edu-wisig-overview-206e82c51852"],
    metric: "accuracy",
    maximumPredictionBytes: 32 * 1024 * 1024,
    distribution: "mirrored",
    providerUrl: "https://cores.ee.ucla.edu/wisig/overview/",
    license: {
      ...CC_BY,
      source_url: "https://cores.ee.ucla.edu/wisig/overview/",
      checked_on: "catalog",
      attribution: ccByAttribution("WiSig (UCLA)", "https://cores.ee.ucla.edu/wisig/overview/"),
    },
  },
] as const;

const RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,120}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DATA_ROLES = ["train", "validation", "test_features"] as const;
const PUBLIC_ROLE_MAP = new Map<string, PublicFileRole>([
  ["train", "train"],
  ["validation", "validation"],
  ["val", "validation"],
  ["test_features", "test_features"],
  ["test", "test_features"],
  ["split_assignment", "split_assignment"],
]);

// Nothing under private/ and nothing that carries labels may ever appear in a public response,
// whatever its `public` flag says.
export function isPrivateEntry(path: unknown, role: unknown): boolean {
  const p = String(path || "").replace(/\\/g, "/").toLowerCase();
  const r = String(role || "").toLowerCase();
  return p.startsWith("private/") || p.includes("/private/") || /label/.test(r) ||
    /hidden[-_]?test|test[-_]?labels?/.test(p);
}

export function listReleaseDescriptors(): readonly ReleaseDescriptor[] {
  return RELEASES;
}

export function getReleaseDescriptor(releaseId: string): ReleaseDescriptor | undefined {
  if (!RELEASE_ID_PATTERN.test(releaseId)) return undefined;
  return RELEASES.find((release) => release.id === releaseId);
}

export function matchingReleaseDescriptors(filter?: string): ReleaseDescriptor[] {
  const normalized = String(filter || "").trim().toLowerCase();
  if (!normalized) return [...RELEASES];
  return RELEASES.filter((release) => [
    release.id,
    release.datasetId,
    release.datasetVersionId,
    release.catalogDatasetVersionId,
    ...release.aliases,
  ].some((candidate) => candidate.toLowerCase() === normalized));
}

function encodeRepositoryPath(...segments: string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

export function publicManifestUrl(releaseId: string): string {
  return `https://huggingface.co/datasets/${PUBLIC_RELEASE_REPO}/resolve/main/${encodeRepositoryPath(releaseId, "manifest.json")}?download=true`;
}

export function publicArtifactUrl(releaseId: string, logicalPath: string): string {
  return `https://huggingface.co/datasets/${PUBLIC_RELEASE_REPO}/resolve/main/${encodeRepositoryPath(releaseId, ...logicalPath.split("/"))}?download=true`;
}

export function evaluatorManifestUrl(releaseId: string): string {
  return `https://huggingface.co/datasets/${PRIVATE_EVALUATOR_REPO}/resolve/main/${encodeRepositoryPath(releaseId, "evaluator-manifest.json")}?download=true`;
}

export function privateEvaluatorArtifactUrl(logicalPath: string): string {
  return `https://huggingface.co/datasets/${PRIVATE_EVALUATOR_REPO}/resolve/main/${encodeRepositoryPath(...logicalPath.split("/"))}?download=true`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fileEndpoint(releaseId: string, role: PublicFileRole): string {
  return `/api/v1/releases/${encodeURIComponent(releaseId)}/files/${role}`;
}

function normalizeArtifact(releaseId: string, raw: ManifestArtifact): PublicReleaseFile | null {
  if (isPrivateEntry(raw.path, raw.role)) return null;
  if (raw.public !== true || typeof raw.role !== "string") return null;
  const role = PUBLIC_ROLE_MAP.get(raw.role);
  if (!role || typeof raw.path !== "string" || !raw.path || raw.path.includes("..")) return null;
  if (typeof raw.sha256 !== "string" || !SHA256_PATTERN.test(raw.sha256)) return null;
  const byteSize = integer(raw.size_bytes, -1);
  if (byteSize < 0) return null;
  return {
    role,
    logical_path: raw.path,
    media_type: typeof raw.media_type === "string" ? raw.media_type : "application/octet-stream",
    byte_size: byteSize,
    sha256: raw.sha256,
    download_endpoint: fileEndpoint(releaseId, role),
  };
}

// Data-role artifacts (public or not) give the reference hashes of OWL's own build, so a
// provider-built split can be checked byte for byte. Label entries are never read here.
function referenceOutputs(rawManifest: SplitManifest): Record<string, { sha256: string; byte_size: number }> {
  const out: Record<string, { sha256: string; byte_size: number }> = {};
  const artifacts = Array.isArray(rawManifest.artifacts) ? rawManifest.artifacts : [];
  for (const item of artifacts) {
    const raw = record(item) as ManifestArtifact;
    if (isPrivateEntry(raw.path, raw.role)) continue;
    const role = PUBLIC_ROLE_MAP.get(String(raw.role || ""));
    if (!role || !(DATA_ROLES as readonly string[]).includes(role)) continue;
    const u = record((raw as Record<string, unknown>).uncompressed);
    const sha = String(u.sha256 || raw.sha256 || "");
    if (!SHA256_PATTERN.test(sha) || isPrivateEntry(u.path, null)) continue;
    // Provider builds write uncompressed CSV, so compare against the uncompressed hash.
    out[role] = { sha256: sha, byte_size: integer(u.size_bytes ?? raw.size_bytes) };
  }
  return out;
}

function providerSource(descriptor: ReleaseDescriptor, rawManifest: SplitManifest) {
  const artifacts = Array.isArray(rawManifest.source_artifacts) ? rawManifest.source_artifacts : [];
  const files: ProviderSourceFile[] = [];
  for (const item of artifacts) {
    const raw = record(item);
    const sha = String(raw.sha256 || "");
    if (!SHA256_PATTERN.test(sha)) continue;
    const base = String(raw.path || "").split("/").pop() || "";
    files.push({
      name: descriptor.sourceFileNames?.[sha] || base,
      sha256: sha,
      byte_size: integer(raw.size_bytes),
    });
  }
  return files.length ? { format: String(rawManifest.source_format || "unknown"), files } : null;
}

export type ReleaseAssets = { buildScript?: string };

// The task file: everything needed to rebuild and score the split, with no data and no labels.
export function publicTaskFile(descriptor: ReleaseDescriptor, rawManifest: SplitManifest): Record<string, unknown> {
  const split = record(rawManifest.split);
  const counts = record(rawManifest.counts);
  const targetFields = stringArray(rawManifest.target_fields);
  return {
    schema_version: "owl-task/1",
    release_id: descriptor.id,
    task_id: String(rawManifest.task_id || descriptor.id),
    dataset_id: descriptor.datasetId,
    catalog_dataset_version_id: descriptor.catalogDatasetVersionId,
    distribution: descriptor.distribution,
    license: descriptor.license,
    provider_url: descriptor.providerUrl,
    target_fields: targetFields,
    feature_fields: stringArray(rawManifest.feature_fields),
    metric: descriptor.metric !== null && targetFields.length === 1 ? descriptor.metric : null,
    sample_id_column: "sample_id",
    split: {
      view: String(split.view || "telemlebench-v1"),
      strategy: String(split.strategy || "explicit"),
      ratios: Array.isArray(split.ratios) ? split.ratios.map(Number) : [],
      seed: Number(split.seed),
    },
    counts: {
      train: integer(counts.train),
      validation: integer(counts.val ?? counts.validation),
      test: integer(counts.test),
    },
    source: {
      ...(providerSource(descriptor, rawManifest) || { format: "unknown", files: [] }),
      // Member names inside the provider files, in the order assignments.csv walks them.
      members: (Array.isArray(rawManifest.source_members) ? rawManifest.source_members : [])
        .map((m) => String(record(m).name || ""))
        .filter(Boolean),
      provider_url: descriptor.providerUrl,
    },
    column_rules: {
      header: "strip whitespace; the n-th repeat of a name becomes name__n",
      numbers: "ECMAScript Number#toString of the parsed value; non-numeric cells stripped",
      order: "sample_id, feature_fields, then target_fields (train and validation only)",
      rows: "assignments.csv order within each split",
    },
    reference_outputs: referenceOutputs(rawManifest),
  };
}

export function taskFileText(descriptor: ReleaseDescriptor, rawManifest: SplitManifest): string {
  return JSON.stringify(publicTaskFile(descriptor, rawManifest), null, 2) + "\n";
}

export function normalizePublicManifest(
  descriptor: ReleaseDescriptor,
  rawManifest: SplitManifest,
  assets: ReleaseAssets = {},
): PublicRelease {
  const split = record(rawManifest.split);
  const counts = record(rawManifest.counts);
  const artifacts = Array.isArray(rawManifest.artifacts) ? rawManifest.artifacts : [];
  let files = artifacts
    .map((artifact) => normalizeArtifact(descriptor.id, record(artifact) as ManifestArtifact))
    .filter((artifact): artifact is PublicReleaseFile => artifact !== null);
  if (descriptor.distribution === "mirrored") {
    const requiredRoles = new Set(files.map((file) => file.role));
    for (const role of DATA_ROLES) {
      if (!requiredRoles.has(role)) {
        throw new Error(`Published release ${descriptor.id} is missing public role ${role}`);
      }
    }
  } else {
    // Provider-only: never list the data files, even if the bytes still exist upstream.
    files = files.filter((file) => !(DATA_ROLES as readonly string[]).includes(file.role));
    if (!files.some((file) => file.role === "split_assignment")) {
      throw new Error(`Provider-only release ${descriptor.id} is missing its split assignment`);
    }
  }
  const train = integer(counts.train);
  const validation = integer(counts.val ?? counts.validation);
  const test = integer(counts.test);
  const ratios = Array.isArray(split.ratios)
    ? split.ratios.map(Number).filter(Number.isFinite)
    : [];
  if (ratios.length !== 3 || Number(split.seed) !== 42) {
    throw new Error(`Published release ${descriptor.id} does not satisfy the 70/15/15 seed-42 contract`);
  }
  if (String(rawManifest.dataset_id || "") !== descriptor.datasetId ||
      String(rawManifest.dataset_version_id || "") !== descriptor.datasetVersionId) {
    throw new Error(`Published release ${descriptor.id} identifier mismatch`);
  }
  const task = taskFileText(descriptor, rawManifest);
  files.push({
    role: "task",
    logical_path: "task.json",
    media_type: "application/json",
    byte_size: Buffer.byteLength(task, "utf8"),
    sha256: sha256Text(task),
    download_endpoint: fileEndpoint(descriptor.id, "task"),
  });
  if (descriptor.distribution === "provider_only" && assets.buildScript) {
    files.push({
      role: "build_script",
      logical_path: "build_split.py",
      media_type: "text/x-python",
      byte_size: Buffer.byteLength(assets.buildScript, "utf8"),
      sha256: sha256Text(assets.buildScript),
      download_endpoint: fileEndpoint(descriptor.id, "build_script"),
    });
  }
  const targetFields = stringArray(rawManifest.target_fields);
  const canEvaluate = descriptor.metric !== null && targetFields.length === 1;
  return {
    id: descriptor.id,
    dataset_id: descriptor.datasetId,
    dataset_version_id: descriptor.datasetVersionId,
    catalog_dataset_version_id: descriptor.catalogDatasetVersionId,
    dataset_aliases: [...descriptor.aliases],
    task_id: String(rawManifest.task_id || descriptor.id),
    release_version: String(split.view || "telemlebench-v1"),
    status: "published",
    distribution: descriptor.distribution,
    provider_url: descriptor.providerUrl,
    license: descriptor.license,
    algorithm_version: String(rawManifest.algorithm_version || "unknown"),
    target_fields: targetFields,
    feature_count: Number.isSafeInteger(Number(rawManifest.feature_count))
      ? Number(rawManifest.feature_count)
      : null,
    split: {
      view: String(split.view || "telemlebench-v1"),
      ratios,
      seed: 42,
      strategy: String(split.strategy || "explicit"),
      counts: { train, validation, test },
    },
    files,
    source: descriptor.distribution === "provider_only" ? providerSource(descriptor, rawManifest) : null,
    manifest_endpoint: `/api/v1/releases/${encodeURIComponent(descriptor.id)}/manifest`,
    task_endpoint: fileEndpoint(descriptor.id, "task"),
    evaluation: {
      available: canEvaluate,
      metric: canEvaluate ? descriptor.metric : null,
      expected_rows: test,
      prediction_columns: canEvaluate ? ["sample_id", "prediction"] : null,
      accepted_media_types: canEvaluate
        ? ["text/csv", "application/csv", "application/gzip", "application/x-gzip"]
        : [],
      maximum_upload_bytes: canEvaluate ? descriptor.maximumPredictionBytes : 0,
      alignment: canEvaluate ? "sample_id_in_test_order" : null,
      score_publication: "private_result_only",
    },
  };
}

export async function fetchRawManifest(
  descriptor: ReleaseDescriptor,
  fetcher: typeof fetch = fetch,
): Promise<SplitManifest> {
  const response = await fetcher(publicManifestUrl(descriptor.id), {
    headers: { Accept: "application/json" },
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`Public manifest fetch failed for ${descriptor.id} (${response.status})`);
  }
  return await response.json() as SplitManifest;
}

export async function fetchPublicRelease(
  descriptor: ReleaseDescriptor,
  fetcher: typeof fetch = fetch,
  assets: ReleaseAssets = {},
): Promise<PublicRelease> {
  return normalizePublicManifest(descriptor, await fetchRawManifest(descriptor, fetcher), assets);
}

export function publicFileByRole(release: PublicRelease, role: string): PublicReleaseFile | undefined {
  return release.files.find((file) => file.role === role);
}
