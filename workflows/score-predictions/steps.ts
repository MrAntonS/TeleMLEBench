import { del, get } from "@vercel/blob";
import { Readable } from "node:stream";

import {
  evaluatorManifestUrl,
  fetchPublicRelease,
  getReleaseDescriptor,
  privateEvaluatorArtifactUrl,
} from "../../server/lib/releases";
import { isPredictionPath } from "../../server/lib/prediction-path";
import {
  PredictionValidationError,
  scoreCsvStreams,
} from "../../server/lib/score-streams.mjs";

export type ScorePredictionsInput = {
  releaseId: string;
  predictionPath: string;
  predictionSize: number;
  requesterFingerprint: string;
};

export type EvaluationOutcome = {
  status: "completed" | "rejected" | "failed";
  release_id: string;
  metric?: {
    name: "accuracy";
    value: number;
    correct: number;
    sample_count: number;
  };
  labels_sha256?: string;
  predictions_sha256?: string;
  scorer_version: "telemlebench-vercel-accuracy/1";
  alignment: {
    join_key: "sample_id";
    mode: "strict_test_order";
  };
  publication: {
    public: false;
    note: string;
  };
  error?: {
    code: string;
    message: string;
    row_number?: number;
  };
  completed_at: string;
};

type EvaluatorManifest = {
  schema_version?: unknown;
  dataset_id?: unknown;
  dataset_version_id?: unknown;
  split_name?: unknown;
  labels?: unknown;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RESULT_BASE = {
  scorer_version: "telemlebench-vercel-accuracy/1" as const,
  alignment: { join_key: "sample_id" as const, mode: "strict_test_order" as const },
  publication: {
    public: false as const,
    note: "This is a private server-verified score, not a published reproduction result.",
  },
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function trustedLabelMetadata(
  releaseId: string,
  manifest: EvaluatorManifest,
  datasetId: string,
  datasetVersionId: string,
): { pathname: string; sha256: string } {
  if (manifest.schema_version !== "telemlebench-evaluator-manifest/1" ||
      manifest.dataset_id !== datasetId ||
      manifest.dataset_version_id !== datasetVersionId ||
      manifest.split_name !== "test") {
    throw new Error("The trusted evaluator manifest does not match the public release");
  }
  const labels = object(manifest.labels);
  const pathname = String(labels.path || "");
  const sha256 = String(labels.sha256 || "").toLowerCase();
  if (labels.join_key !== "sample_id" ||
      !pathname.startsWith(`${releaseId}/private/`) ||
      pathname.includes("..") ||
      !SHA256_PATTERN.test(sha256)) {
    throw new Error("The trusted evaluator manifest has invalid label metadata");
  }
  return { pathname, sha256 };
}

function now(): string {
  return new Date().toISOString();
}

export async function scorePredictionStep(
  input: ScorePredictionsInput,
): Promise<EvaluationOutcome> {
  "use step";

  const descriptor = getReleaseDescriptor(input.releaseId);
  if (!descriptor || descriptor.metric !== "accuracy" ||
      !isPredictionPath(input.releaseId, input.predictionPath)) {
    return {
      ...RESULT_BASE,
      status: "rejected",
      release_id: input.releaseId,
      error: { code: "invalid_release", message: "This release is not available for evaluation." },
      completed_at: now(),
    };
  }
  const hfToken = String(process.env.HF_TOKEN || "").trim();
  if (!hfToken) throw new Error("HF_TOKEN is not configured for the trusted evaluator");

  const publicRelease = await fetchPublicRelease(descriptor);
  if (!publicRelease.evaluation.available || publicRelease.target_fields.length !== 1) {
    return {
      ...RESULT_BASE,
      status: "rejected",
      release_id: input.releaseId,
      error: { code: "evaluation_unavailable", message: "This release has no supervised hidden-label evaluator." },
      completed_at: now(),
    };
  }

  const manifestResponse = await fetch(evaluatorManifestUrl(input.releaseId), {
    headers: { Accept: "application/json", Authorization: `Bearer ${hfToken}` },
    cache: "no-store",
  });
  if (!manifestResponse.ok) {
    throw new Error(`Trusted evaluator manifest fetch failed (${manifestResponse.status})`);
  }
  const evaluatorManifest = await manifestResponse.json() as EvaluatorManifest;
  const labelMetadata = trustedLabelMetadata(
    input.releaseId,
    evaluatorManifest,
    descriptor.datasetId,
    descriptor.datasetVersionId,
  );

  const [labelResponse, predictionBlob] = await Promise.all([
    fetch(privateEvaluatorArtifactUrl(labelMetadata.pathname), {
      headers: { Authorization: `Bearer ${hfToken}` },
      cache: "no-store",
    }),
    get(input.predictionPath, { access: "private", useCache: false }),
  ]);
  if (!labelResponse.ok || !labelResponse.body) {
    throw new Error(`Trusted label fetch failed (${labelResponse.status})`);
  }
  if (!predictionBlob || predictionBlob.statusCode !== 200 || !predictionBlob.stream) {
    return {
      ...RESULT_BASE,
      status: "rejected",
      release_id: input.releaseId,
      error: { code: "prediction_not_found", message: "The private prediction upload is no longer available." },
      completed_at: now(),
    };
  }
  if (predictionBlob.blob.size !== input.predictionSize ||
      predictionBlob.blob.size > descriptor.maximumPredictionBytes) {
    return {
      ...RESULT_BASE,
      status: "rejected",
      release_id: input.releaseId,
      error: { code: "prediction_size_mismatch", message: "The uploaded prediction size does not match the submitted metadata." },
      completed_at: now(),
    };
  }

  try {
    const score = await scoreCsvStreams({
      labelStream: Readable.fromWeb(labelResponse.body as never),
      predictionStream: Readable.fromWeb(predictionBlob.stream as never),
      labelsCompressed: labelMetadata.pathname.endsWith(".gz"),
      predictionsCompressed: input.predictionPath.endsWith(".gz"),
      expectedRows: publicRelease.evaluation.expected_rows,
      expectedLabelsSha256: labelMetadata.sha256,
    });
    return {
      ...RESULT_BASE,
      status: "completed",
      release_id: input.releaseId,
      metric: {
        name: "accuracy",
        value: score.value,
        correct: score.correct,
        sample_count: score.sampleCount,
      },
      labels_sha256: score.labelsSha256,
      predictions_sha256: score.predictionsSha256,
      completed_at: now(),
    };
  } catch (error) {
    if (error instanceof PredictionValidationError) {
      return {
        ...RESULT_BASE,
        status: "rejected",
        release_id: input.releaseId,
        error: {
          code: error.code,
          message: error.message,
          ...(error.rowNumber ? { row_number: error.rowNumber } : {}),
        },
        completed_at: now(),
      };
    }
    throw error;
  }
}

export async function removePredictionStep(predictionPathname: string): Promise<boolean> {
  "use step";

  try {
    await del(predictionPathname);
    return true;
  } catch (error) {
    console.error("Private prediction cleanup failed", {
      pathname: predictionPathname,
      error: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}
