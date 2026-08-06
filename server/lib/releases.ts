export const PUBLIC_RELEASE_REPO = "NextGLab/telemlebench-releases";
export const PRIVATE_EVALUATOR_REPO = "NextGLab/telemlebench-evaluator";

export type ReleaseDescriptor = {
  id: string;
  datasetId: string;
  datasetVersionId: string;
  aliases: string[];
  metric: "accuracy" | null;
  maximumPredictionBytes: number;
};

export type PublicReleaseFile = {
  role: "train" | "validation" | "test_features" | "split_assignment";
  logical_path: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  download_endpoint: string;
};

export type PublicRelease = {
  id: string;
  dataset_id: string;
  dataset_version_id: string;
  dataset_aliases: string[];
  task_id: string;
  release_version: string;
  status: "published";
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
  manifest_endpoint: string;
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
  schema_version?: unknown;
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

const RELEASES: readonly ReleaseDescriptor[] = [
  {
    id: "cicids2017-flow-classification-v1",
    datasetId: "tmleb:curated-url-https-www-unb-ca-cic-datasets-ids-2017-html-ce90b96ad6f7",
    datasetVersionId: "dsv_23647609e257911ae43693c0",
    aliases: ["cicids2017", "cicids-2017"],
    metric: "accuracy",
    maximumPredictionBytes: 128 * 1024 * 1024,
  },
  {
    id: "ciciot2023-attack-classification-v1",
    datasetId: "tmleb:curated-url-https-www-unb-ca-cic-datasets-iotdataset-2023-html-73dd07fac094",
    datasetVersionId: "dsv_a19618cffe36f58e6bb774fe",
    aliases: ["ciciot2023", "cic-iot-2023"],
    metric: "accuracy",
    maximumPredictionBytes: 768 * 1024 * 1024,
  },
  {
    id: "n-baiot-attack-classification-v1",
    datasetId: "10.24432/c5rc8j",
    datasetVersionId: "dsv_d8d665aa98bc2aea62b619f4",
    aliases: ["n-baiot", "nbaiot"],
    metric: "accuracy",
    maximumPredictionBytes: 192 * 1024 * 1024,
  },
  {
    id: "radioml2016-10a-modulation-classification-v1",
    datasetId: "10.5281/zenodo.18397069",
    datasetVersionId: "dsv_765b73be81844f30db00ed66",
    aliases: ["radioml2016-10a", "radioml-2016.10a", "radioml-2016-10a"],
    metric: "accuracy",
    maximumPredictionBytes: 32 * 1024 * 1024,
  },
  {
    id: "topologybench-clustering-v1",
    datasetId: "10.5281/zenodo.12593794",
    datasetVersionId: "dsv_2b4b6c2f2f46033eaebd4f5e",
    aliases: ["topologybench"],
    metric: null,
    maximumPredictionBytes: 0,
  },
  {
    id: "ujindoorloc-floor-v1",
    datasetId: "10.24432/c5ms59",
    datasetVersionId: "dsv_10089411a0c5dbed537ad731",
    aliases: ["ujindoorloc", "ujiindoorloc"],
    metric: "accuracy",
    maximumPredictionBytes: 16 * 1024 * 1024,
  },
  {
    id: "veremi-extension-misbehavior-classification-v1",
    datasetId: "10.5281/zenodo.20090854",
    datasetVersionId: "dsv_b4b70c9e0abb5c1c91dc310f",
    aliases: ["veremi-extension"],
    metric: "accuracy",
    maximumPredictionBytes: 1024 * 1024 * 1024,
  },
  {
    id: "veremi-misbehavior-classification-v1",
    datasetId: "10.5281/zenodo.20081895",
    datasetVersionId: "dsv_a130fc2ac4a437717b45eb35",
    aliases: ["veremi"],
    metric: "accuracy",
    maximumPredictionBytes: 512 * 1024 * 1024,
  },
  {
    id: "wisig-manysig-transmitter-classification-v1",
    datasetId: "tmleb:curated-url-https-cores-ee-ucla-edu-wisig-overview-206e82c51852",
    datasetVersionId: "dsv_ea3c9fdcb35dd7b1770c4281",
    aliases: ["wisig", "wisig-manysig"],
    metric: "accuracy",
    maximumPredictionBytes: 32 * 1024 * 1024,
  },
] as const;

const RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,120}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PUBLIC_ROLE_MAP = new Map<string, PublicReleaseFile["role"]>([
  ["train", "train"],
  ["validation", "validation"],
  ["val", "validation"],
  ["test_features", "test_features"],
  ["test", "test_features"],
  ["split_assignment", "split_assignment"],
]);

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

function normalizeArtifact(releaseId: string, raw: ManifestArtifact): PublicReleaseFile | null {
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
    download_endpoint: `/api/v1/releases/${encodeURIComponent(releaseId)}/files/${role}`,
  };
}

export function normalizePublicManifest(
  descriptor: ReleaseDescriptor,
  rawManifest: SplitManifest,
): PublicRelease {
  const split = record(rawManifest.split);
  const counts = record(rawManifest.counts);
  const artifacts = Array.isArray(rawManifest.artifacts) ? rawManifest.artifacts : [];
  const files = artifacts
    .map((artifact) => normalizeArtifact(descriptor.id, record(artifact) as ManifestArtifact))
    .filter((artifact): artifact is PublicReleaseFile => artifact !== null);
  const requiredRoles = new Set(files.map((file) => file.role));
  for (const role of ["train", "validation", "test_features"] as const) {
    if (!requiredRoles.has(role)) {
      throw new Error(`Published release ${descriptor.id} is missing public role ${role}`);
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
  const targetFields = stringArray(rawManifest.target_fields);
  const canEvaluate = descriptor.metric !== null && targetFields.length === 1;
  return {
    id: descriptor.id,
    dataset_id: descriptor.datasetId,
    dataset_version_id: descriptor.datasetVersionId,
    dataset_aliases: [...descriptor.aliases],
    task_id: String(rawManifest.task_id || descriptor.id),
    release_version: String(split.view || "telemlebench-v1"),
    status: "published",
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
    manifest_endpoint: `/api/v1/releases/${encodeURIComponent(descriptor.id)}/manifest`,
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

export async function fetchPublicRelease(
  descriptor: ReleaseDescriptor,
  fetcher: typeof fetch = fetch,
): Promise<PublicRelease> {
  const response = await fetcher(publicManifestUrl(descriptor.id), {
    headers: { Accept: "application/json" },
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`Public manifest fetch failed for ${descriptor.id} (${response.status})`);
  }
  return normalizePublicManifest(descriptor, await response.json() as SplitManifest);
}

export function publicFileByRole(release: PublicRelease, role: string): PublicReleaseFile | undefined {
  return release.files.find((file) => file.role === role);
}
