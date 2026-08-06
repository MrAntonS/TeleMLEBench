globalThis.__nitro_main__ = import.meta.url;
import { createRequire as __wkfCreateRequire } from "node:module";
if (typeof globalThis.require === "undefined") globalThis.require = __wkfCreateRequire(import.meta.url);
import { _ as NodeResponse, a as defineHandler, c as getMethod, g as toEventHandler, h as setResponseStatus, i as defineEventHandler, m as setHeader, n as HTTPError, o as defineLazyEventHandler, s as getHeader, t as H3Core, u as getRequestURL, v as serve } from "./_libs/h3+rou3+srvx.mjs";
import { i as withoutTrailingSlash, n as joinURL, r as withLeadingSlash, t as decodePath } from "./_libs/ufo.mjs";
import { a as resumeWebhook, n as stepEntrypoint, o as registerStepFunction, t as workflowEntrypoint } from "./_libs/@workflow/core+[...].mjs";
import { n as del, r as get } from "./_libs/@vercel/blob+[...].mjs";
import "./_libs/workflow.mjs";
import { a as privateEvaluatorArtifactUrl, n as fetchPublicRelease, r as getReleaseDescriptor, t as evaluatorManifestUrl } from "./_chunks/releases.mjs";
import { t as parse } from "./_libs/csv-parse.mjs";
import { t as builtin_modules_default } from "./_libs/builtin-modules.mjs";
import { Readable, Transform } from "node:stream";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { promises } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
//#region node_modules/.nitro/workflow/webhook.mjs
async function handler(request) {
	const pathParts = new URL(request.url).pathname.split("/");
	const token = decodeURIComponent(pathParts[pathParts.length - 1]);
	if (!token) return new Response("Missing token", { status: 400 });
	try {
		return await resumeWebhook(token, request);
	} catch (error) {
		console.error("Error during resumeWebhook", error);
		return new Response(null, { status: 404 });
	}
}
var POST$1 = handler;
//#endregion
//#region #workflow/webhook.mjs
var webhook_default = async ({ req }) => {
	try {
		return await POST$1(req);
	} catch (error) {
		console.error("Handler error:", error);
		return new Response("Internal Server Error", { status: 500 });
	}
};
//#endregion
//#region server/lib/prediction-path.ts
var UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function isPredictionPath(releaseId, pathname) {
	if (!getReleaseDescriptor(releaseId)) return false;
	const prefix = `evaluations/${releaseId}/`;
	const remainder = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
	const separator = remainder.indexOf("/");
	if (separator < 0) return false;
	const uploadId = remainder.slice(0, separator);
	const filename = remainder.slice(separator + 1);
	return UPLOAD_ID_PATTERN.test(uploadId) && (filename === "predictions.csv" || filename === "predictions.csv.gz");
}
//#endregion
//#region server/lib/score-streams.mjs
var SHA256_PATTERN$1 = /^[a-f0-9]{64}$/;
var MAX_RECORD_BYTES = 1048576;
var MAX_SAMPLE_ID_BYTES = 2048;
var PredictionValidationError = class extends Error {
	constructor(code, message, rowNumber = null) {
		super(message);
		this.name = "PredictionValidationError";
		this.code = code;
		this.rowNumber = rowNumber;
	}
};
function hashingPass(hash) {
	return new Transform({ transform(chunk, _encoding, callback) {
		hash.update(chunk);
		callback(null, chunk);
	} });
}
function csvRows(source, compressed, hash) {
	let decoded = source.pipe(hashingPass(hash));
	if (compressed) decoded = decoded.pipe(createGunzip());
	return decoded.pipe(parse({
		bom: true,
		columns: false,
		encoding: "utf8",
		max_record_size: MAX_RECORD_BYTES,
		relax_column_count: false,
		relax_quotes: false,
		skip_empty_lines: false,
		trim: false
	}));
}
function exactHeader(actual, expected, label) {
	if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new PredictionValidationError("invalid_header", `${label} CSV header must be exactly ${expected.join(",")}`);
}
function labelHeader(actual) {
	if (!Array.isArray(actual) || actual.length !== 2 || actual[0] !== "sample_id" || !actual[1] || actual[1] === "prediction") throw new Error("The trusted label artifact has an invalid schema");
}
function validRow(row) {
	return Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && typeof row[1] === "string";
}
function destroy(stream) {
	if (stream && typeof stream.destroy === "function" && !stream.destroyed) stream.destroy();
}
/**
* Stream an accuracy evaluation without loading labels or predictions into memory.
* The prediction rows must preserve the public test-feature order; every row is
* still joined and checked by sample_id before its value is compared.
*/
async function scoreCsvStreams({ labelStream, predictionStream, labelsCompressed = false, predictionsCompressed = false, expectedRows, expectedLabelsSha256 }) {
	if (!Number.isSafeInteger(expectedRows) || expectedRows <= 0) throw new Error("The trusted evaluator has no positive expected row count");
	if (!SHA256_PATTERN$1.test(String(expectedLabelsSha256 || ""))) throw new Error("The trusted evaluator label hash is invalid");
	const labelHash = createHash("sha256");
	const predictionHash = createHash("sha256");
	const labels = csvRows(labelStream, labelsCompressed, labelHash);
	const predictions = csvRows(predictionStream, predictionsCompressed, predictionHash);
	const labelIterator = labels[Symbol.asyncIterator]();
	const predictionIterator = predictions[Symbol.asyncIterator]();
	let sampleCount = 0;
	let correct = 0;
	try {
		const [labelFirst, predictionFirst] = await Promise.all([labelIterator.next(), predictionIterator.next()]);
		if (labelFirst.done) throw new Error("The trusted label artifact is empty");
		if (predictionFirst.done) throw new PredictionValidationError("empty_predictions", "Prediction CSV is empty");
		labelHeader(labelFirst.value);
		exactHeader(predictionFirst.value, ["sample_id", "prediction"], "Prediction");
		while (true) {
			const [labelNext, predictionNext] = await Promise.all([labelIterator.next(), predictionIterator.next()]);
			if (labelNext.done || predictionNext.done) {
				if (labelNext.done !== predictionNext.done) throw new PredictionValidationError(predictionNext.done ? "missing_predictions" : "extra_predictions", predictionNext.done ? "Prediction CSV ended before every test sample was scored" : "Prediction CSV contains rows beyond the test split", sampleCount + 2);
				break;
			}
			sampleCount += 1;
			if (sampleCount > expectedRows) throw new PredictionValidationError("extra_predictions", "Prediction CSV contains rows beyond the published test split", sampleCount + 1);
			if (!validRow(labelNext.value)) throw new Error(`The trusted label artifact has an invalid row at ${sampleCount + 1}`);
			if (!validRow(predictionNext.value)) throw new PredictionValidationError("invalid_row", "Every prediction row must contain exactly sample_id and prediction", sampleCount + 1);
			const [expectedId, expectedValue] = labelNext.value;
			const [submittedId, submittedValue] = predictionNext.value;
			if (!submittedId || Buffer.byteLength(submittedId, "utf8") > MAX_SAMPLE_ID_BYTES) throw new PredictionValidationError("invalid_sample_id", "Prediction sample_id is empty or too long", sampleCount + 1);
			if (submittedId !== expectedId) throw new PredictionValidationError("sample_id_mismatch", "Prediction sample_id does not match the public test-feature order", sampleCount + 1);
			if (submittedValue === "") throw new PredictionValidationError("empty_prediction", "Prediction values cannot be empty", sampleCount + 1);
			if (submittedValue === expectedValue) correct += 1;
		}
		if (sampleCount !== expectedRows) throw new PredictionValidationError(sampleCount < expectedRows ? "missing_predictions" : "extra_predictions", `Prediction CSV contains ${sampleCount} data rows; ${expectedRows} are required`);
		const labelsSha256 = labelHash.digest("hex");
		if (labelsSha256 !== expectedLabelsSha256) throw new Error("The trusted label artifact failed its SHA-256 integrity check");
		return {
			correct,
			sampleCount,
			value: correct / sampleCount,
			labelsSha256,
			predictionsSha256: predictionHash.digest("hex")
		};
	} finally {
		destroy(labels);
		destroy(predictions);
		destroy(labelStream);
		destroy(predictionStream);
	}
}
//#endregion
//#region node_modules/.nitro/workflow/steps.mjs
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", {
	value,
	configurable: true
});
async function __builtin_response_array_buffer() {
	return this.arrayBuffer();
}
__name(__builtin_response_array_buffer, "__builtin_response_array_buffer");
async function __builtin_response_json() {
	return this.json();
}
__name(__builtin_response_json, "__builtin_response_json");
async function __builtin_response_text() {
	return this.text();
}
__name(__builtin_response_text, "__builtin_response_text");
registerStepFunction("__builtin_response_array_buffer", __builtin_response_array_buffer);
registerStepFunction("__builtin_response_json", __builtin_response_json);
registerStepFunction("__builtin_response_text", __builtin_response_text);
async function fetch2(...args) {
	return globalThis.fetch(...args);
}
__name(fetch2, "fetch");
registerStepFunction("step//workflow@4.8.0//fetch", fetch2);
var SHA256_PATTERN = /^[a-f0-9]{64}$/;
var RESULT_BASE = {
	scorer_version: "telemlebench-vercel-accuracy/1",
	alignment: {
		join_key: "sample_id",
		mode: "strict_test_order"
	},
	publication: {
		public: false,
		note: "This is a private server-verified score, not a published reproduction result."
	}
};
function object(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
__name(object, "object");
function trustedLabelMetadata(releaseId, manifest, datasetId, datasetVersionId) {
	if (manifest.schema_version !== "telemlebench-evaluator-manifest/1" || manifest.dataset_id !== datasetId || manifest.dataset_version_id !== datasetVersionId || manifest.split_name !== "test") throw new Error("The trusted evaluator manifest does not match the public release");
	const labels = object(manifest.labels);
	const pathname = String(labels.path || "");
	const sha256 = String(labels.sha256 || "").toLowerCase();
	if (labels.join_key !== "sample_id" || !pathname.startsWith(`${releaseId}/private/`) || pathname.includes("..") || !SHA256_PATTERN.test(sha256)) throw new Error("The trusted evaluator manifest has invalid label metadata");
	return {
		pathname,
		sha256
	};
}
__name(trustedLabelMetadata, "trustedLabelMetadata");
function now() {
	return (/* @__PURE__ */ new Date()).toISOString();
}
__name(now, "now");
async function scorePredictionStep(input) {
	const descriptor = getReleaseDescriptor(input.releaseId);
	if (!descriptor || descriptor.metric !== "accuracy" || !isPredictionPath(input.releaseId, input.predictionPath)) return {
		...RESULT_BASE,
		status: "rejected",
		release_id: input.releaseId,
		error: {
			code: "invalid_release",
			message: "This release is not available for evaluation."
		},
		completed_at: now()
	};
	const hfToken = String(process.env.HF_TOKEN || "").trim();
	if (!hfToken) throw new Error("HF_TOKEN is not configured for the trusted evaluator");
	const publicRelease = await fetchPublicRelease(descriptor);
	if (!publicRelease.evaluation.available || publicRelease.target_fields.length !== 1) return {
		...RESULT_BASE,
		status: "rejected",
		release_id: input.releaseId,
		error: {
			code: "evaluation_unavailable",
			message: "This release has no supervised hidden-label evaluator."
		},
		completed_at: now()
	};
	const manifestResponse = await fetch(evaluatorManifestUrl(input.releaseId), {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${hfToken}`
		},
		cache: "no-store"
	});
	if (!manifestResponse.ok) throw new Error(`Trusted evaluator manifest fetch failed (${manifestResponse.status})`);
	const evaluatorManifest = await manifestResponse.json();
	const labelMetadata = trustedLabelMetadata(input.releaseId, evaluatorManifest, descriptor.datasetId, descriptor.datasetVersionId);
	const [labelResponse, predictionBlob] = await Promise.all([fetch(privateEvaluatorArtifactUrl(labelMetadata.pathname), {
		headers: { Authorization: `Bearer ${hfToken}` },
		cache: "no-store"
	}), get(input.predictionPath, {
		access: "private",
		useCache: false
	})]);
	if (!labelResponse.ok || !labelResponse.body) throw new Error(`Trusted label fetch failed (${labelResponse.status})`);
	if (!predictionBlob || predictionBlob.statusCode !== 200 || !predictionBlob.stream) return {
		...RESULT_BASE,
		status: "rejected",
		release_id: input.releaseId,
		error: {
			code: "prediction_not_found",
			message: "The private prediction upload is no longer available."
		},
		completed_at: now()
	};
	if (predictionBlob.blob.size !== input.predictionSize || predictionBlob.blob.size > descriptor.maximumPredictionBytes) return {
		...RESULT_BASE,
		status: "rejected",
		release_id: input.releaseId,
		error: {
			code: "prediction_size_mismatch",
			message: "The uploaded prediction size does not match the submitted metadata."
		},
		completed_at: now()
	};
	try {
		const score = await scoreCsvStreams({
			labelStream: Readable.fromWeb(labelResponse.body),
			predictionStream: Readable.fromWeb(predictionBlob.stream),
			labelsCompressed: labelMetadata.pathname.endsWith(".gz"),
			predictionsCompressed: input.predictionPath.endsWith(".gz"),
			expectedRows: publicRelease.evaluation.expected_rows,
			expectedLabelsSha256: labelMetadata.sha256
		});
		return {
			...RESULT_BASE,
			status: "completed",
			release_id: input.releaseId,
			metric: {
				name: "accuracy",
				value: score.value,
				correct: score.correct,
				sample_count: score.sampleCount
			},
			labels_sha256: score.labelsSha256,
			predictions_sha256: score.predictionsSha256,
			completed_at: now()
		};
	} catch (error) {
		if (error instanceof PredictionValidationError) return {
			...RESULT_BASE,
			status: "rejected",
			release_id: input.releaseId,
			error: {
				code: error.code,
				message: error.message,
				...error.rowNumber ? { row_number: error.rowNumber } : {}
			},
			completed_at: now()
		};
		throw error;
	}
}
__name(scorePredictionStep, "scorePredictionStep");
async function removePredictionStep(predictionPathname) {
	try {
		await del(predictionPathname);
		return true;
	} catch (error) {
		console.error("Private prediction cleanup failed", {
			pathname: predictionPathname,
			error: error instanceof Error ? error.name : "unknown"
		});
		return false;
	}
}
__name(removePredictionStep, "removePredictionStep");
registerStepFunction("step//./workflows/score-predictions/steps//scorePredictionStep", scorePredictionStep);
registerStepFunction("step//./workflows/score-predictions/steps//removePredictionStep", removePredictionStep);
var nodeBuiltins = builtin_modules_default.join("|");
new RegExp(`(?:from\\s+['"](?:node:)?((?:${nodeBuiltins})(?:/[^'"]*)?)['"]|require\\s*\\(\\s*['"](?:node:)?((?:${nodeBuiltins})(?:/[^'"]*)?)['"]\\s*\\))`, "g");
//#endregion
//#region #workflow/steps.mjs
var steps_default = async ({ req }) => {
	try {
		return await stepEntrypoint(req);
	} catch (error) {
		console.error("Handler error:", error);
		return new Response("Internal Server Error", { status: 500 });
	}
};
var POST = workflowEntrypoint(`globalThis.__private_workflows = new Map();
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// workflows/score-predictions/steps.ts
var scorePredictionStep = globalThis[/* @__PURE__ */ Symbol.for("WORKFLOW_USE_STEP")]("step//./workflows/score-predictions/steps//scorePredictionStep");
var removePredictionStep = globalThis[/* @__PURE__ */ Symbol.for("WORKFLOW_USE_STEP")]("step//./workflows/score-predictions/steps//removePredictionStep");

// workflows/score-predictions/index.ts
async function scorePredictionsWorkflow(input) {
  let outcome;
  try {
    outcome = await scorePredictionStep(input);
  } catch {
    outcome = {
      status: "failed",
      release_id: input.releaseId,
      scorer_version: "telemlebench-vercel-accuracy/1",
      alignment: {
        join_key: "sample_id",
        mode: "strict_test_order"
      },
      publication: {
        public: false,
        note: "This is a private server-verified score, not a published reproduction result."
      },
      error: {
        code: "evaluation_failed",
        message: "The trusted evaluator could not complete this run. The hidden labels were not exposed."
      },
      completed_at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  await removePredictionStep(input.predictionPath);
  return outcome;
}
__name(scorePredictionsWorkflow, "scorePredictionsWorkflow");
scorePredictionsWorkflow.workflowId = "workflow//./workflows/score-predictions/index//scorePredictionsWorkflow";
globalThis.__private_workflows.set("workflow//./workflows/score-predictions/index//scorePredictionsWorkflow", scorePredictionsWorkflow);

// node_modules/builtin-modules/builtin-modules.json
var builtin_modules_default = [
  "node:assert",
  "assert",
  "node:assert/strict",
  "assert/strict",
  "node:async_hooks",
  "async_hooks",
  "node:buffer",
  "buffer",
  "node:child_process",
  "child_process",
  "node:cluster",
  "cluster",
  "node:console",
  "console",
  "node:constants",
  "constants",
  "node:crypto",
  "crypto",
  "node:dgram",
  "dgram",
  "node:diagnostics_channel",
  "diagnostics_channel",
  "node:dns",
  "dns",
  "node:dns/promises",
  "dns/promises",
  "node:domain",
  "domain",
  "node:events",
  "events",
  "node:fs",
  "fs",
  "node:fs/promises",
  "fs/promises",
  "node:http",
  "http",
  "node:http2",
  "http2",
  "node:https",
  "https",
  "node:inspector",
  "inspector",
  "node:inspector/promises",
  "inspector/promises",
  "node:module",
  "module",
  "node:net",
  "net",
  "node:os",
  "os",
  "node:path",
  "path",
  "node:path/posix",
  "path/posix",
  "node:path/win32",
  "path/win32",
  "node:perf_hooks",
  "perf_hooks",
  "node:process",
  "process",
  "node:querystring",
  "querystring",
  "node:quic",
  "node:readline",
  "readline",
  "node:readline/promises",
  "readline/promises",
  "node:repl",
  "repl",
  "node:sea",
  "node:sqlite",
  "node:stream",
  "stream",
  "node:stream/consumers",
  "stream/consumers",
  "node:stream/promises",
  "stream/promises",
  "node:stream/web",
  "stream/web",
  "node:string_decoder",
  "string_decoder",
  "node:test",
  "node:test/reporters",
  "node:timers",
  "timers",
  "node:timers/promises",
  "timers/promises",
  "node:tls",
  "tls",
  "node:trace_events",
  "trace_events",
  "node:tty",
  "tty",
  "node:url",
  "url",
  "node:util",
  "util",
  "node:util/types",
  "util/types",
  "node:v8",
  "v8",
  "node:vm",
  "vm",
  "node:wasi",
  "wasi",
  "node:worker_threads",
  "worker_threads",
  "node:zlib",
  "zlib"
];

// node_modules/builtin-modules/index.js
var builtin_modules_default2 = builtin_modules_default;

// node_modules/@workflow/builders/dist/serde-checker.js
var nodeBuiltins = builtin_modules_default2.join("|");
var nodeImportExtractRegex = new RegExp(\`(?:from\\\\s+['"](?:node:)?((?:\${nodeBuiltins})(?:/[^'"]*)?)['"]|require\\\\s*\\\\(\\\\s*['"](?:node:)?((?:\${nodeBuiltins})(?:/[^'"]*)?)['"]\\\\s*\\\\))\`, "g");
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsid29ya2Zsb3dzL3Njb3JlLXByZWRpY3Rpb25zL3N0ZXBzLnRzIiwgIndvcmtmbG93cy9zY29yZS1wcmVkaWN0aW9ucy9pbmRleC50cyIsICJub2RlX21vZHVsZXMvYnVpbHRpbi1tb2R1bGVzL2J1aWx0aW4tbW9kdWxlcy5qc29uIiwgIm5vZGVfbW9kdWxlcy9idWlsdGluLW1vZHVsZXMvaW5kZXguanMiLCAibm9kZV9tb2R1bGVzL0B3b3JrZmxvdy9idWlsZGVycy9zcmMvc2VyZGUtY2hlY2tlci50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqX19pbnRlcm5hbF93b3JrZmxvd3N7XCJzdGVwc1wiOntcIndvcmtmbG93cy9zY29yZS1wcmVkaWN0aW9ucy9zdGVwcy50c1wiOntcInJlbW92ZVByZWRpY3Rpb25TdGVwXCI6e1wic3RlcElkXCI6XCJzdGVwLy8uL3dvcmtmbG93cy9zY29yZS1wcmVkaWN0aW9ucy9zdGVwcy8vcmVtb3ZlUHJlZGljdGlvblN0ZXBcIn0sXCJzY29yZVByZWRpY3Rpb25TdGVwXCI6e1wic3RlcElkXCI6XCJzdGVwLy8uL3dvcmtmbG93cy9zY29yZS1wcmVkaWN0aW9ucy9zdGVwcy8vc2NvcmVQcmVkaWN0aW9uU3RlcFwifX19fSovO1xuZXhwb3J0IHZhciBzY29yZVByZWRpY3Rpb25TdGVwID0gZ2xvYmFsVGhpc1tTeW1ib2wuZm9yKFwiV09SS0ZMT1dfVVNFX1NURVBcIildKFwic3RlcC8vLi93b3JrZmxvd3Mvc2NvcmUtcHJlZGljdGlvbnMvc3RlcHMvL3Njb3JlUHJlZGljdGlvblN0ZXBcIik7XG5leHBvcnQgdmFyIHJlbW92ZVByZWRpY3Rpb25TdGVwID0gZ2xvYmFsVGhpc1tTeW1ib2wuZm9yKFwiV09SS0ZMT1dfVVNFX1NURVBcIildKFwic3RlcC8vLi93b3JrZmxvd3Mvc2NvcmUtcHJlZGljdGlvbnMvc3RlcHMvL3JlbW92ZVByZWRpY3Rpb25TdGVwXCIpO1xuIiwgImltcG9ydCB7IHJlbW92ZVByZWRpY3Rpb25TdGVwLCBzY29yZVByZWRpY3Rpb25TdGVwIH0gZnJvbSBcIi4vc3RlcHNcIjtcbi8qKl9faW50ZXJuYWxfd29ya2Zsb3dze1wid29ya2Zsb3dzXCI6e1wid29ya2Zsb3dzL3Njb3JlLXByZWRpY3Rpb25zL2luZGV4LnRzXCI6e1wic2NvcmVQcmVkaWN0aW9uc1dvcmtmbG93XCI6e1wid29ya2Zsb3dJZFwiOlwid29ya2Zsb3cvLy4vd29ya2Zsb3dzL3Njb3JlLXByZWRpY3Rpb25zL2luZGV4Ly9zY29yZVByZWRpY3Rpb25zV29ya2Zsb3dcIn19fX0qLztcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzY29yZVByZWRpY3Rpb25zV29ya2Zsb3coaW5wdXQpIHtcbiAgICBsZXQgb3V0Y29tZTtcbiAgICB0cnkge1xuICAgICAgICBvdXRjb21lID0gYXdhaXQgc2NvcmVQcmVkaWN0aW9uU3RlcChpbnB1dCk7XG4gICAgfSBjYXRjaCAge1xuICAgICAgICBvdXRjb21lID0ge1xuICAgICAgICAgICAgc3RhdHVzOiBcImZhaWxlZFwiLFxuICAgICAgICAgICAgcmVsZWFzZV9pZDogaW5wdXQucmVsZWFzZUlkLFxuICAgICAgICAgICAgc2NvcmVyX3ZlcnNpb246IFwidGVsZW1sZWJlbmNoLXZlcmNlbC1hY2N1cmFjeS8xXCIsXG4gICAgICAgICAgICBhbGlnbm1lbnQ6IHtcbiAgICAgICAgICAgICAgICBqb2luX2tleTogXCJzYW1wbGVfaWRcIixcbiAgICAgICAgICAgICAgICBtb2RlOiBcInN0cmljdF90ZXN0X29yZGVyXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwdWJsaWNhdGlvbjoge1xuICAgICAgICAgICAgICAgIHB1YmxpYzogZmFsc2UsXG4gICAgICAgICAgICAgICAgbm90ZTogXCJUaGlzIGlzIGEgcHJpdmF0ZSBzZXJ2ZXItdmVyaWZpZWQgc2NvcmUsIG5vdCBhIHB1Ymxpc2hlZCByZXByb2R1Y3Rpb24gcmVzdWx0LlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZXJyb3I6IHtcbiAgICAgICAgICAgICAgICBjb2RlOiBcImV2YWx1YXRpb25fZmFpbGVkXCIsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogXCJUaGUgdHJ1c3RlZCBldmFsdWF0b3IgY291bGQgbm90IGNvbXBsZXRlIHRoaXMgcnVuLiBUaGUgaGlkZGVuIGxhYmVscyB3ZXJlIG5vdCBleHBvc2VkLlwiXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29tcGxldGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfTtcbiAgICB9XG4gICAgYXdhaXQgcmVtb3ZlUHJlZGljdGlvblN0ZXAoaW5wdXQucHJlZGljdGlvblBhdGgpO1xuICAgIHJldHVybiBvdXRjb21lO1xufVxuc2NvcmVQcmVkaWN0aW9uc1dvcmtmbG93LndvcmtmbG93SWQgPSBcIndvcmtmbG93Ly8uL3dvcmtmbG93cy9zY29yZS1wcmVkaWN0aW9ucy9pbmRleC8vc2NvcmVQcmVkaWN0aW9uc1dvcmtmbG93XCI7XG5nbG9iYWxUaGlzLl9fcHJpdmF0ZV93b3JrZmxvd3Muc2V0KFwid29ya2Zsb3cvLy4vd29ya2Zsb3dzL3Njb3JlLXByZWRpY3Rpb25zL2luZGV4Ly9zY29yZVByZWRpY3Rpb25zV29ya2Zsb3dcIiwgc2NvcmVQcmVkaWN0aW9uc1dvcmtmbG93KTtcbiIsICJbXG5cdFwibm9kZTphc3NlcnRcIixcblx0XCJhc3NlcnRcIixcblx0XCJub2RlOmFzc2VydC9zdHJpY3RcIixcblx0XCJhc3NlcnQvc3RyaWN0XCIsXG5cdFwibm9kZTphc3luY19ob29rc1wiLFxuXHRcImFzeW5jX2hvb2tzXCIsXG5cdFwibm9kZTpidWZmZXJcIixcblx0XCJidWZmZXJcIixcblx0XCJub2RlOmNoaWxkX3Byb2Nlc3NcIixcblx0XCJjaGlsZF9wcm9jZXNzXCIsXG5cdFwibm9kZTpjbHVzdGVyXCIsXG5cdFwiY2x1c3RlclwiLFxuXHRcIm5vZGU6Y29uc29sZVwiLFxuXHRcImNvbnNvbGVcIixcblx0XCJub2RlOmNvbnN0YW50c1wiLFxuXHRcImNvbnN0YW50c1wiLFxuXHRcIm5vZGU6Y3J5cHRvXCIsXG5cdFwiY3J5cHRvXCIsXG5cdFwibm9kZTpkZ3JhbVwiLFxuXHRcImRncmFtXCIsXG5cdFwibm9kZTpkaWFnbm9zdGljc19jaGFubmVsXCIsXG5cdFwiZGlhZ25vc3RpY3NfY2hhbm5lbFwiLFxuXHRcIm5vZGU6ZG5zXCIsXG5cdFwiZG5zXCIsXG5cdFwibm9kZTpkbnMvcHJvbWlzZXNcIixcblx0XCJkbnMvcHJvbWlzZXNcIixcblx0XCJub2RlOmRvbWFpblwiLFxuXHRcImRvbWFpblwiLFxuXHRcIm5vZGU6ZXZlbnRzXCIsXG5cdFwiZXZlbnRzXCIsXG5cdFwibm9kZTpmc1wiLFxuXHRcImZzXCIsXG5cdFwibm9kZTpmcy9wcm9taXNlc1wiLFxuXHRcImZzL3Byb21pc2VzXCIsXG5cdFwibm9kZTpodHRwXCIsXG5cdFwiaHR0cFwiLFxuXHRcIm5vZGU6aHR0cDJcIixcblx0XCJodHRwMlwiLFxuXHRcIm5vZGU6aHR0cHNcIixcblx0XCJodHRwc1wiLFxuXHRcIm5vZGU6aW5zcGVjdG9yXCIsXG5cdFwiaW5zcGVjdG9yXCIsXG5cdFwibm9kZTppbnNwZWN0b3IvcHJvbWlzZXNcIixcblx0XCJpbnNwZWN0b3IvcHJvbWlzZXNcIixcblx0XCJub2RlOm1vZHVsZVwiLFxuXHRcIm1vZHVsZVwiLFxuXHRcIm5vZGU6bmV0XCIsXG5cdFwibmV0XCIsXG5cdFwibm9kZTpvc1wiLFxuXHRcIm9zXCIsXG5cdFwibm9kZTpwYXRoXCIsXG5cdFwicGF0aFwiLFxuXHRcIm5vZGU6cGF0aC9wb3NpeFwiLFxuXHRcInBhdGgvcG9zaXhcIixcblx0XCJub2RlOnBhdGgvd2luMzJcIixcblx0XCJwYXRoL3dpbjMyXCIsXG5cdFwibm9kZTpwZXJmX2hvb2tzXCIsXG5cdFwicGVyZl9ob29rc1wiLFxuXHRcIm5vZGU6cHJvY2Vzc1wiLFxuXHRcInByb2Nlc3NcIixcblx0XCJub2RlOnF1ZXJ5c3RyaW5nXCIsXG5cdFwicXVlcnlzdHJpbmdcIixcblx0XCJub2RlOnF1aWNcIixcblx0XCJub2RlOnJlYWRsaW5lXCIsXG5cdFwicmVhZGxpbmVcIixcblx0XCJub2RlOnJlYWRsaW5lL3Byb21pc2VzXCIsXG5cdFwicmVhZGxpbmUvcHJvbWlzZXNcIixcblx0XCJub2RlOnJlcGxcIixcblx0XCJyZXBsXCIsXG5cdFwibm9kZTpzZWFcIixcblx0XCJub2RlOnNxbGl0ZVwiLFxuXHRcIm5vZGU6c3RyZWFtXCIsXG5cdFwic3RyZWFtXCIsXG5cdFwibm9kZTpzdHJlYW0vY29uc3VtZXJzXCIsXG5cdFwic3RyZWFtL2NvbnN1bWVyc1wiLFxuXHRcIm5vZGU6c3RyZWFtL3Byb21pc2VzXCIsXG5cdFwic3RyZWFtL3Byb21pc2VzXCIsXG5cdFwibm9kZTpzdHJlYW0vd2ViXCIsXG5cdFwic3RyZWFtL3dlYlwiLFxuXHRcIm5vZGU6c3RyaW5nX2RlY29kZXJcIixcblx0XCJzdHJpbmdfZGVjb2RlclwiLFxuXHRcIm5vZGU6dGVzdFwiLFxuXHRcIm5vZGU6dGVzdC9yZXBvcnRlcnNcIixcblx0XCJub2RlOnRpbWVyc1wiLFxuXHRcInRpbWVyc1wiLFxuXHRcIm5vZGU6dGltZXJzL3Byb21pc2VzXCIsXG5cdFwidGltZXJzL3Byb21pc2VzXCIsXG5cdFwibm9kZTp0bHNcIixcblx0XCJ0bHNcIixcblx0XCJub2RlOnRyYWNlX2V2ZW50c1wiLFxuXHRcInRyYWNlX2V2ZW50c1wiLFxuXHRcIm5vZGU6dHR5XCIsXG5cdFwidHR5XCIsXG5cdFwibm9kZTp1cmxcIixcblx0XCJ1cmxcIixcblx0XCJub2RlOnV0aWxcIixcblx0XCJ1dGlsXCIsXG5cdFwibm9kZTp1dGlsL3R5cGVzXCIsXG5cdFwidXRpbC90eXBlc1wiLFxuXHRcIm5vZGU6djhcIixcblx0XCJ2OFwiLFxuXHRcIm5vZGU6dm1cIixcblx0XCJ2bVwiLFxuXHRcIm5vZGU6d2FzaVwiLFxuXHRcIndhc2lcIixcblx0XCJub2RlOndvcmtlcl90aHJlYWRzXCIsXG5cdFwid29ya2VyX3RocmVhZHNcIixcblx0XCJub2RlOnpsaWJcIixcblx0XCJ6bGliXCJcbl1cbiIsICJpbXBvcnQgYnVpbHRpbk1vZHVsZXMgZnJvbSAnLi9idWlsdGluLW1vZHVsZXMuanNvbic7XG5leHBvcnQgZGVmYXVsdCBidWlsdGluTW9kdWxlcztcbiIsICIvKipcbiAqIFNlcmRlIGNvbXBsaWFuY2UgY2hlY2tlciBmb3Igd29ya2Zsb3cgY3VzdG9tIGNsYXNzIHNlcmlhbGl6YXRpb24uXG4gKlxuICogQW5hbHl6ZXMgc291cmNlIGNvZGUgdG8gZGV0ZXJtaW5lIGlmIGNsYXNzZXMgd2l0aCBXT1JLRkxPV19TRVJJQUxJWkUgL1xuICogV09SS0ZMT1dfREVTRVJJQUxJWkUgYXJlIGNvcnJlY3RseSBzZXQgdXAgZm9yIHRoZSB3b3JrZmxvdyBzYW5kYm94LlxuICpcbiAqIFVzZWQgYnk6XG4gKiAtIENMSSBgdmFsaWRhdGVgIGNvbW1hbmRcbiAqIC0gQ0xJIGB0cmFuc2Zvcm1gIGNvbW1hbmQgKC0tY2hlY2stc2VyZGUpXG4gKiAtIFNXQyBwbGF5Z3JvdW5kIHNlcmRlIGFuYWx5c2lzIHBhbmVsXG4gKiAtIEJ1aWxkLXRpbWUgd2FybmluZ3MgaW4gQmFzZUJ1aWxkZXJcbiAqL1xuXG5pbXBvcnQgYnVpbHRpbk1vZHVsZXMgZnJvbSAnYnVpbHRpbi1tb2R1bGVzJztcbmltcG9ydCB0eXBlIHsgV29ya2Zsb3dNYW5pZmVzdCB9IGZyb20gJy4vYXBwbHktc3djLXRyYW5zZm9ybS5qcyc7XG5cbi8vIEJ1aWxkIGEgcmVnZXggdGhhdCBtYXRjaGVzIE5vZGUuanMgYnVpbHQtaW4gbW9kdWxlIGltcG9ydHMgaW4gdHJhbnNmb3JtZWQgY29kZS5cbi8vIEhhbmRsZXMgYm90aCBFU00gKGBmcm9tICdmcydgLCBgZnJvbSAnbm9kZTpmcydgKSBhbmQgQ0pTIChgcmVxdWlyZSgnZnMnKWApXG5jb25zdCBub2RlQnVpbHRpbnMgPSBidWlsdGluTW9kdWxlcy5qb2luKCd8Jyk7XG5cbi8vIFJlZ2V4IHRvIGV4dHJhY3Qgc3BlY2lmaWMgbW9kdWxlIG5hbWVzIGZyb20gaW1wb3J0L3JlcXVpcmUgc3RhdGVtZW50c1xuY29uc3Qgbm9kZUltcG9ydEV4dHJhY3RSZWdleCA9IG5ldyBSZWdFeHAoXG4gIGAoPzpmcm9tXFxcXHMrWydcIl0oPzpub2RlOik/KCg/OiR7bm9kZUJ1aWx0aW5zfSkoPzovW14nXCJdKik/KVsnXCJdYCArXG4gICAgYHxyZXF1aXJlXFxcXHMqXFxcXChcXFxccypbJ1wiXSg/Om5vZGU6KT8oKD86JHtub2RlQnVpbHRpbnN9KSg/Oi9bXidcIl0qKT8pWydcIl1cXFxccypcXFxcKSlgLFxuICAnZydcbik7XG5cbi8vIFJlZ2V4IHRvIGRldGVjdCBjbGFzcyByZWdpc3RyYXRpb24gSUlGRXMgZ2VuZXJhdGVkIGJ5IHRoZSBTV0MgcGx1Z2luXG5jb25zdCByZWdpc3RyYXRpb25JaWZlUmVnZXggPVxuICAvU3ltYm9sXFwuZm9yXFxzKlxcKFxccypbXCInXXdvcmtmbG93LWNsYXNzLXJlZ2lzdHJ5W1wiJ11cXHMqXFwpLztcblxuLyoqXG4gKiBSZXN1bHQgb2YgY2hlY2tpbmcgYSBzaW5nbGUgY2xhc3MgZm9yIHNlcmRlIGNvbXBsaWFuY2UuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2VyZGVDbGFzc0NoZWNrUmVzdWx0IHtcbiAgLyoqIFRoZSBjbGFzcyBuYW1lIGFzIGRldGVjdGVkIGluIHRoZSBzb3VyY2UgKi9cbiAgY2xhc3NOYW1lOiBzdHJpbmc7XG4gIC8qKiBUaGUgY2xhc3NJZCBhc3NpZ25lZCBieSB0aGUgU1dDIHBsdWdpbiAoZnJvbSB0aGUgbWFuaWZlc3QpICovXG4gIGNsYXNzSWQ6IHN0cmluZztcbiAgLyoqIFdoZXRoZXIgdGhlIFNXQyBwbHVnaW4gZGV0ZWN0ZWQgc2VyZGUgc3ltYm9scyBvbiB0aGlzIGNsYXNzICovXG4gIGRldGVjdGVkOiBib29sZWFuO1xuICAvKiogV2hldGhlciBhIHJlZ2lzdHJhdGlvbiBJSUZFIHdhcyBnZW5lcmF0ZWQgaW4gdGhlIG91dHB1dCAqL1xuICByZWdpc3RlcmVkOiBib29sZWFuO1xuICAvKipcbiAgICogTm9kZS5qcyBidWlsdC1pbiBtb2R1bGUgaW1wb3J0cyByZW1haW5pbmcgaW4gdGhlIHdvcmtmbG93LW1vZGUgb3V0cHV0LlxuICAgKiBJZiBub24tZW1wdHksIHRoZSBjbGFzcyBpcyBOT1Qgd29ya2Zsb3ctc2FuZGJveCBjb21wbGlhbnQuXG4gICAqL1xuICBub2RlSW1wb3J0czogc3RyaW5nW107XG4gIC8qKiBXaGV0aGVyIHRoZSBjbGFzcyBwYXNzZXMgYWxsIGNvbXBsaWFuY2UgY2hlY2tzICovXG4gIGNvbXBsaWFudDogYm9vbGVhbjtcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIGRlc2NyaXB0aW9ucyBvZiBhbnkgaXNzdWVzIGZvdW5kICovXG4gIGlzc3Vlczogc3RyaW5nW107XG59XG5cbi8qKlxuICogRnVsbCByZXN1bHQgb2Ygc2VyZGUgY29tcGxpYW5jZSBhbmFseXNpcyBmb3IgYSBzb3VyY2UgZmlsZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBTZXJkZUNoZWNrUmVzdWx0IHtcbiAgLyoqIFBlci1jbGFzcyBhbmFseXNpcyByZXN1bHRzICovXG4gIGNsYXNzZXM6IFNlcmRlQ2xhc3NDaGVja1Jlc3VsdFtdO1xuICAvKiogQWxsIE5vZGUuanMgYnVpbHQtaW4gaW1wb3J0cyBmb3VuZCBpbiB0aGUgd29ya2Zsb3ctbW9kZSBvdXRwdXQgKi9cbiAgZ2xvYmFsTm9kZUltcG9ydHM6IHN0cmluZ1tdO1xuICAvKiogV2hldGhlciB0aGUgd29ya2Zsb3ctbW9kZSBvdXRwdXQgY29udGFpbnMgYW55IHNlcmRlLXJlbGF0ZWQgY2xhc3NlcyAqL1xuICBoYXNTZXJkZUNsYXNzZXM6IGJvb2xlYW47XG4gIC8qKiBUaGUgcmF3IHdvcmtmbG93IG1hbmlmZXN0IGV4dHJhY3RlZCBmcm9tIHRoZSBTV0MgdHJhbnNmb3JtICovXG4gIG1hbmlmZXN0OiBXb3JrZmxvd01hbmlmZXN0O1xufVxuXG4vKipcbiAqIExpZ2h0d2VpZ2h0IHNlcmRlIGNvbXBsaWFuY2UgY2hlY2tlciB0aGF0IHdvcmtzIHdpdGggcHJlLWNvbXB1dGVkXG4gKiBTV0MgdHJhbnNmb3JtIHJlc3VsdHMuIFRoaXMgYXZvaWRzIHJlLXJ1bm5pbmcgdGhlIFNXQyB0cmFuc2Zvcm1cbiAqIHdoZW4gdGhlIGNhbGxlciBhbHJlYWR5IGhhcyB0aGUgb3V0cHV0cyAoZS5nLiwgdGhlIHBsYXlncm91bmQgb3IgYnVpbGRlcikuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhbmFseXplU2VyZGVDb21wbGlhbmNlKG9wdGlvbnM6IHtcbiAgLyoqIFNvdXJjZSBjb2RlICh1c2VkIGZvciBwYXR0ZXJuIGRldGVjdGlvbikgKi9cbiAgc291cmNlQ29kZTogc3RyaW5nO1xuICAvKiogV29ya2Zsb3ctbW9kZSB0cmFuc2Zvcm1lZCBvdXRwdXQgKi9cbiAgd29ya2Zsb3dDb2RlOiBzdHJpbmc7XG4gIC8qKiBNYW5pZmVzdCBleHRyYWN0ZWQgZnJvbSB0aGUgU1dDIHRyYW5zZm9ybSAqL1xuICBtYW5pZmVzdDogV29ya2Zsb3dNYW5pZmVzdDtcbn0pOiBTZXJkZUNoZWNrUmVzdWx0IHtcbiAgY29uc3QgeyBzb3VyY2VDb2RlLCB3b3JrZmxvd0NvZGUsIG1hbmlmZXN0IH0gPSBvcHRpb25zO1xuXG4gIC8vIDEuIEV4dHJhY3QgYWxsIE5vZGUuanMgYnVpbHQtaW4gaW1wb3J0cyBmcm9tIHRoZSB3b3JrZmxvdyBvdXRwdXRcbiAgY29uc3QgZ2xvYmFsTm9kZUltcG9ydHMgPSBleHRyYWN0Tm9kZUltcG9ydHMod29ya2Zsb3dDb2RlKTtcblxuICAvLyAyLiBDaGVjayBpZiB0aGUgbWFuaWZlc3QgY29udGFpbnMgYW55IHNlcmRlLXJlZ2lzdGVyZWQgY2xhc3Nlc1xuICBjb25zdCBjbGFzc0VudHJpZXMgPSBleHRyYWN0Q2xhc3NFbnRyaWVzKG1hbmlmZXN0KTtcbiAgY29uc3QgaGFzU2VyZGVDbGFzc2VzID0gY2xhc3NFbnRyaWVzLmxlbmd0aCA+IDA7XG5cbiAgLy8gMy4gQ2hlY2sgaWYgdGhlIHdvcmtmbG93IG91dHB1dCBjb250YWlucyByZWdpc3RyYXRpb24gSUlGRXNcbiAgY29uc3QgaGFzUmVnaXN0cmF0aW9uID0gcmVnaXN0cmF0aW9uSWlmZVJlZ2V4LnRlc3Qod29ya2Zsb3dDb2RlKTtcblxuICAvLyA0LiBBbmFseXplIGVhY2ggY2xhc3NcbiAgY29uc3QgY2xhc3NlczogU2VyZGVDbGFzc0NoZWNrUmVzdWx0W10gPSBjbGFzc0VudHJpZXMubWFwKChlbnRyeSkgPT4ge1xuICAgIGNvbnN0IGlzc3Vlczogc3RyaW5nW10gPSBbXTtcblxuICAgIC8vIENoZWNrIGZvciBOb2RlLmpzIGltcG9ydHMgKHRoZXNlIHdpbGwgZmFpbCBpbiB0aGUgd29ya2Zsb3cgc2FuZGJveClcbiAgICBpZiAoZ2xvYmFsTm9kZUltcG9ydHMubGVuZ3RoID4gMCkge1xuICAgICAgaXNzdWVzLnB1c2goXG4gICAgICAgIGBXb3JrZmxvdyBidW5kbGUgY29udGFpbnMgTm9kZS5qcyBidWlsdC1pbiBpbXBvcnRzOiAke2dsb2JhbE5vZGVJbXBvcnRzLmpvaW4oJywgJyl9LiBgICtcbiAgICAgICAgICBgVGhlc2Ugd2lsbCBmYWlsIGF0IHJ1bnRpbWUgaW4gdGhlIHdvcmtmbG93IHNhbmRib3guIGAgK1xuICAgICAgICAgIGBBZGQgXCJ1c2Ugc3RlcFwiIHRvIG1ldGhvZHMgdGhhdCBkZXBlbmQgb24gTm9kZS5qcyBBUElzIHNvIHRoZXkgYXJlIHN0cmlwcGVkIGZyb20gdGhlIHdvcmtmbG93IGJ1bmRsZS5gXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIENoZWNrIGZvciByZWdpc3RyYXRpb25cbiAgICBpZiAoIWhhc1JlZ2lzdHJhdGlvbikge1xuICAgICAgaXNzdWVzLnB1c2goXG4gICAgICAgIGBObyBjbGFzcyByZWdpc3RyYXRpb24gSUlGRSB3YXMgZ2VuZXJhdGVkLiBgICtcbiAgICAgICAgICBgRW5zdXJlIFdPUktGTE9XX1NFUklBTElaRSBhbmQgV09SS0ZMT1dfREVTRVJJQUxJWkUgYXJlIGRlZmluZWQgYXMgc3RhdGljIG1ldGhvZHMgYCArXG4gICAgICAgICAgYGluc2lkZSB0aGUgY2xhc3MgYm9keSB1c2luZyBjb21wdXRlZCBwcm9wZXJ0eSBzeW50YXg6IHN0YXRpYyBbV09SS0ZMT1dfU0VSSUFMSVpFXSguLi4pIHsgLi4uIH1gXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBjbGFzc05hbWU6IGVudHJ5LmNsYXNzTmFtZSxcbiAgICAgIGNsYXNzSWQ6IGVudHJ5LmNsYXNzSWQsXG4gICAgICBkZXRlY3RlZDogdHJ1ZSxcbiAgICAgIHJlZ2lzdGVyZWQ6IGhhc1JlZ2lzdHJhdGlvbixcbiAgICAgIG5vZGVJbXBvcnRzOiBnbG9iYWxOb2RlSW1wb3J0cyxcbiAgICAgIGNvbXBsaWFudDogZ2xvYmFsTm9kZUltcG9ydHMubGVuZ3RoID09PSAwICYmIGhhc1JlZ2lzdHJhdGlvbixcbiAgICAgIGlzc3VlcyxcbiAgICB9O1xuICB9KTtcblxuICAvLyA1LiBDaGVjayBmb3IgY2xhc3NlcyB0aGF0IGhhdmUgc2VyZGUgcGF0dGVybnMgaW4gc291cmNlIGJ1dCB3ZXJlbid0IGRldGVjdGVkIGJ5IFNXQ1xuICBjb25zdCBzb3VyY2VIYXNTZXJkZVBhdHRlcm5zID1cbiAgICAvXFxbXFxzKldPUktGTE9XXyg/OlNFUklBTElaRXxERVNFUklBTElaRSlcXHMqXFxdLy50ZXN0KHNvdXJjZUNvZGUpIHx8XG4gICAgL1N5bWJvbFxcLmZvclxccypcXChcXHMqWydcIl13b3JrZmxvdy0oPzpzZXJpYWxpemV8ZGVzZXJpYWxpemUpWydcIl1cXHMqXFwpLy50ZXN0KFxuICAgICAgc291cmNlQ29kZVxuICAgICk7XG5cbiAgaWYgKHNvdXJjZUhhc1NlcmRlUGF0dGVybnMgJiYgY2xhc3NFbnRyaWVzLmxlbmd0aCA9PT0gMCkge1xuICAgIGNsYXNzZXMucHVzaCh7XG4gICAgICBjbGFzc05hbWU6ICc8dW5rbm93bj4nLFxuICAgICAgY2xhc3NJZDogJycsXG4gICAgICBkZXRlY3RlZDogZmFsc2UsXG4gICAgICByZWdpc3RlcmVkOiBmYWxzZSxcbiAgICAgIG5vZGVJbXBvcnRzOiBnbG9iYWxOb2RlSW1wb3J0cyxcbiAgICAgIGNvbXBsaWFudDogZmFsc2UsXG4gICAgICBpc3N1ZXM6IFtcbiAgICAgICAgYFNvdXJjZSBjb2RlIGNvbnRhaW5zIFdPUktGTE9XX1NFUklBTElaRS9XT1JLRkxPV19ERVNFUklBTElaRSBwYXR0ZXJucyBidXQgYCArXG4gICAgICAgICAgYHRoZSBTV0MgcGx1Z2luIGRpZCBub3QgZGV0ZWN0IGFueSBzZXJkZS1lbmFibGVkIGNsYXNzZXMuIGAgK1xuICAgICAgICAgIGBFbnN1cmUgdGhlIHN5bWJvbHMgYXJlIGRlZmluZWQgYXMgc3RhdGljIG1ldGhvZHMgSU5TSURFIHRoZSBjbGFzcyBib2R5LCBgICtcbiAgICAgICAgICBgbm90IGFzc2lnbmVkIGV4dGVybmFsbHkgKGUuZy4sIChNeUNsYXNzIGFzIGFueSlbV09SS0ZMT1dfU0VSSUFMSVpFXSA9IC4uLikuYCxcbiAgICAgIF0sXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGNsYXNzZXMsXG4gICAgZ2xvYmFsTm9kZUltcG9ydHMsXG4gICAgaGFzU2VyZGVDbGFzc2VzLFxuICAgIG1hbmlmZXN0LFxuICB9O1xufVxuXG4vKipcbiAqIEV4dHJhY3QgTm9kZS5qcyBidWlsdC1pbiBtb2R1bGUgbmFtZXMgZnJvbSB0cmFuc2Zvcm1lZCBjb2RlLlxuICovXG5mdW5jdGlvbiBleHRyYWN0Tm9kZUltcG9ydHMoY29kZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBpbXBvcnRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIC8vIFJlc2V0IHJlZ2V4IHN0YXRlXG4gIG5vZGVJbXBvcnRFeHRyYWN0UmVnZXgubGFzdEluZGV4ID0gMDtcbiAgZm9yIChcbiAgICBsZXQgbWF0Y2ggPSBub2RlSW1wb3J0RXh0cmFjdFJlZ2V4LmV4ZWMoY29kZSk7XG4gICAgbWF0Y2ggIT09IG51bGw7XG4gICAgbWF0Y2ggPSBub2RlSW1wb3J0RXh0cmFjdFJlZ2V4LmV4ZWMoY29kZSlcbiAgKSB7XG4gICAgLy8gbWF0Y2hbMV0gaXMgZnJvbSB0aGUgRVNNIHBhdHRlcm4sIG1hdGNoWzJdIGlzIGZyb20gdGhlIENKUyBwYXR0ZXJuXG4gICAgY29uc3QgbW9kdWxlTmFtZSA9IG1hdGNoWzFdIHx8IG1hdGNoWzJdO1xuICAgIGlmIChtb2R1bGVOYW1lKSB7XG4gICAgICAvLyBOb3JtYWxpemUgdG8gYmFzZSBtb2R1bGUgbmFtZSAoZS5nLiwgJ2ZzL3Byb21pc2VzJyAtPiAnZnMnKVxuICAgICAgaW1wb3J0cy5hZGQobW9kdWxlTmFtZS5zcGxpdCgnLycpWzBdKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIFsuLi5pbXBvcnRzXS5zb3J0KCk7XG59XG5cbi8qKlxuICogRXh0cmFjdCBjbGFzcyBlbnRyaWVzIGZyb20gYSBXb3JrZmxvd01hbmlmZXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXh0cmFjdENsYXNzRW50cmllcyhcbiAgbWFuaWZlc3Q6IFdvcmtmbG93TWFuaWZlc3Rcbik6IEFycmF5PHsgY2xhc3NOYW1lOiBzdHJpbmc7IGNsYXNzSWQ6IHN0cmluZzsgZmlsZU5hbWU6IHN0cmluZyB9PiB7XG4gIGNvbnN0IGVudHJpZXM6IEFycmF5PHtcbiAgICBjbGFzc05hbWU6IHN0cmluZztcbiAgICBjbGFzc0lkOiBzdHJpbmc7XG4gICAgZmlsZU5hbWU6IHN0cmluZztcbiAgfT4gPSBbXTtcbiAgaWYgKCFtYW5pZmVzdC5jbGFzc2VzKSByZXR1cm4gZW50cmllcztcblxuICBmb3IgKGNvbnN0IFtmaWxlTmFtZSwgY2xhc3Nlc10gb2YgT2JqZWN0LmVudHJpZXMobWFuaWZlc3QuY2xhc3NlcykpIHtcbiAgICBmb3IgKGNvbnN0IFtjbGFzc05hbWUsIHsgY2xhc3NJZCB9XSBvZiBPYmplY3QuZW50cmllcyhjbGFzc2VzKSkge1xuICAgICAgZW50cmllcy5wdXNoKHsgY2xhc3NOYW1lLCBjbGFzc0lkLCBmaWxlTmFtZSB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJu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
`);
//#endregion
//#region #workflow/workflows.mjs
var workflows_default = async ({ req }) => {
	try {
		return await POST(req);
	} catch (error) {
		console.error("Handler error:", error);
		return new Response("Internal Server Error", { status: 500 });
	}
};
//#endregion
//#region #nitro/virtual/public-assets-data
var public_assets_data_default = {};
//#endregion
//#region #nitro/virtual/public-assets-node
function readAsset(id) {
	const serverDir = dirname(fileURLToPath(globalThis.__nitro_main__));
	return promises.readFile(resolve(serverDir, public_assets_data_default[id].path));
}
//#endregion
//#region #nitro/virtual/public-assets
var publicAssetBases = {};
function isPublicAssetURL(id = "") {
	if (public_assets_data_default[id]) return true;
	for (const base in publicAssetBases) if (id.startsWith(base)) return true;
	return false;
}
function getAsset(id) {
	return public_assets_data_default[id];
}
//#endregion
//#region node_modules/nitro/dist/runtime/internal/static.mjs
var METHODS = /* @__PURE__ */ new Set(["HEAD", "GET"]);
var EncodingMap = {
	gzip: ".gz",
	br: ".br",
	zstd: ".zst"
};
var static_default = defineHandler((event) => {
	if (event.req.method && !METHODS.has(event.req.method)) return;
	let id = decodePath(withLeadingSlash(withoutTrailingSlash(event.url.pathname)));
	let asset;
	const encodings = [...(event.req.headers.get("accept-encoding") || "").split(",").map((e) => EncodingMap[e.trim()]).filter(Boolean).sort(), ""];
	for (const encoding of encodings) for (const _id of [id + encoding, joinURL(id, "index.html" + encoding)]) {
		const _asset = getAsset(_id);
		if (_asset) {
			asset = _asset;
			id = _id;
			break;
		}
	}
	if (!asset) {
		if (isPublicAssetURL(id)) {
			event.res.headers.delete("Cache-Control");
			throw new HTTPError({ status: 404 });
		}
		return;
	}
	if (encodings.length > 1) event.res.headers.append("Vary", "Accept-Encoding");
	if (event.req.headers.get("if-none-match") === asset.etag) {
		event.res.status = 304;
		event.res.statusText = "Not Modified";
		return "";
	}
	const ifModifiedSinceH = event.req.headers.get("if-modified-since");
	const mtimeDate = new Date(asset.mtime);
	if (ifModifiedSinceH && asset.mtime && new Date(ifModifiedSinceH) >= mtimeDate) {
		event.res.status = 304;
		event.res.statusText = "Not Modified";
		return "";
	}
	if (asset.type) event.res.headers.set("Content-Type", asset.type);
	if (asset.etag && !event.res.headers.has("ETag")) event.res.headers.set("ETag", asset.etag);
	if (asset.mtime && !event.res.headers.has("Last-Modified")) event.res.headers.set("Last-Modified", mtimeDate.toUTCString());
	if (asset.encoding && !event.res.headers.has("Content-Encoding")) event.res.headers.set("Content-Encoding", asset.encoding);
	if (asset.size > 0 && !event.res.headers.has("Content-Length")) event.res.headers.set("Content-Length", asset.size.toString());
	return readAsset(id);
});
//#endregion
//#region server/middleware/github-pages-cors.ts
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set(["https://mrantons.github.io"]);
var github_pages_cors_default = defineEventHandler((event) => {
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
//#endregion
//#region #nitro/virtual/routing
var _lazy_NhkWRt = defineLazyEventHandler(() => import("./_evaluationId_.get.mjs"));
var _lazy_AFY_NM = defineLazyEventHandler(() => import("./_routes/api/v1/evaluations/config.mjs"));
var _lazy_WgqGEc = defineLazyEventHandler(() => import("./_routes/api/v1/evaluations.mjs"));
var _lazy_p8b600 = defineLazyEventHandler(() => import("./_routes/api/v1/evaluations/uploads.mjs"));
var _lazy_xra67O = defineLazyEventHandler(() => import("./_routes/api/v1.mjs"));
var _lazy_BoR5YH = defineLazyEventHandler(() => import("./_routes/api/v1/openapi.json.mjs"));
var _lazy_E0XJBE = defineLazyEventHandler(() => import("./_role_.get.mjs"));
var _lazy_l0HB9M = defineLazyEventHandler(() => import("./_routes/api/v1/releases/[releaseId].mjs"));
var _lazy_R61j0R = defineLazyEventHandler(() => import("./_routes/api/v1/releases/[releaseId]/manifest.mjs"));
var _lazy_c5LtuZ = defineLazyEventHandler(() => import("./_routes/api/v1/releases.mjs"));
var _lazy_25s9Pr = defineLazyEventHandler(() => import("./_routes/healthz.mjs"));
var _lazy_klx8Hp = defineLazyEventHandler(() => import("./_routes/index.mjs"));
var findRoute = /* @__PURE__ */ (() => {
	const $0 = {
		route: "/.well-known/workflow/v1/step",
		handler: toEventHandler(steps_default)
	}, $1 = {
		route: "/.well-known/workflow/v1/flow",
		handler: toEventHandler(workflows_default)
	}, $2 = {
		route: "/api/v1/evaluations/config",
		method: "get",
		handler: _lazy_AFY_NM
	}, $3 = {
		route: "/api/v1/evaluations",
		method: "post",
		handler: _lazy_WgqGEc
	}, $4 = {
		route: "/api/v1/evaluations/uploads",
		method: "post",
		handler: _lazy_p8b600
	}, $5 = {
		route: "/api/v1",
		method: "get",
		handler: _lazy_xra67O
	}, $6 = {
		route: "/api/v1/openapi.json",
		method: "get",
		handler: _lazy_BoR5YH
	}, $7 = {
		route: "/api/v1/releases",
		method: "get",
		handler: _lazy_c5LtuZ
	}, $8 = {
		route: "/healthz",
		method: "get",
		handler: _lazy_25s9Pr
	}, $9 = {
		route: "/",
		method: "get",
		handler: _lazy_klx8Hp
	}, $10 = {
		route: "/.well-known/workflow/v1/webhook/:token",
		handler: toEventHandler(webhook_default)
	}, $11 = {
		route: "/api/v1/evaluations/:evaluationId",
		method: "get",
		handler: _lazy_NhkWRt
	}, $12 = {
		route: "/api/v1/releases/:releaseId",
		method: "get",
		handler: _lazy_l0HB9M
	}, $13 = {
		route: "/api/v1/releases/:releaseId/files/:role",
		method: "get",
		handler: _lazy_E0XJBE
	}, $14 = {
		route: "/api/v1/releases/:releaseId/manifest",
		method: "get",
		handler: _lazy_R61j0R
	};
	return (m, p) => {
		if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1) || "/";
		if (p === "/.well-known/workflow/v1/step") return { data: $0 };
		else if (p === "/.well-known/workflow/v1/flow") return { data: $1 };
		else if (p === "/api/v1/evaluations/config") {
			if (m === "GET") return { data: $2 };
		} else if (p === "/api/v1/evaluations") {
			if (m === "POST") return { data: $3 };
		} else if (p === "/api/v1/evaluations/uploads") {
			if (m === "POST") return { data: $4 };
		} else if (p === "/api/v1") {
			if (m === "GET") return { data: $5 };
		} else if (p === "/api/v1/openapi.json") {
			if (m === "GET") return { data: $6 };
		} else if (p === "/api/v1/releases") {
			if (m === "GET") return { data: $7 };
		} else if (p === "/healthz") {
			if (m === "GET") return { data: $8 };
		} else if (p === "/") {
			if (m === "GET") return { data: $9 };
		}
		let s = p.split("/"), l = s.length;
		if (l > 1) {
			if (s[1] === ".well-known") {
				if (l > 2) {
					if (s[2] === "workflow") {
						if (l > 3) {
							if (s[3] === "v1") {
								if (l > 4) {
									if (s[4] === "webhook") {
										if (l === 6 || l === 5) {
											if (l > 5) return {
												data: $10,
												params: { "token": s[5] }
											};
										}
									}
								}
							}
						}
					}
				}
			} else if (s[1] === "api") {
				if (l > 2) {
					if (s[2] === "v1") {
						if (l > 3) {
							if (s[3] === "evaluations") {
								if (l === 5 || l === 4) {
									if (m === "GET") {
										if (l > 4) return {
											data: $11,
											params: { "evaluationId": s[4] }
										};
									}
								}
							} else if (s[3] === "releases") {
								if (l === 5 || l === 4) {
									if (m === "GET") {
										if (l > 4) return {
											data: $12,
											params: { "releaseId": s[4] }
										};
									}
								} else if (s[5] === "files") {
									if (l === 7 || l === 6) {
										if (m === "GET") {
											if (l > 6) return {
												data: $13,
												params: {
													"releaseId": s[4],
													"role": s[6]
												}
											};
										}
									}
								} else if (s[5] === "manifest") {
									if (l === 6) {
										if (m === "GET") return {
											data: $14,
											params: { "releaseId": s[4] }
										};
									}
								}
							}
						}
					}
				}
			}
		}
	};
})();
var globalMiddleware = [toEventHandler(static_default), toEventHandler(github_pages_cors_default)].filter(Boolean);
//#endregion
//#region node_modules/nitro/dist/runtime/internal/error/prod.mjs
var errorHandler = (error, event) => {
	const res = defaultHandler(error, event);
	return new NodeResponse(typeof res.body === "string" ? res.body : JSON.stringify(res.body, null, 2), res);
};
function defaultHandler(error, event) {
	const unhandled = error.unhandled ?? !HTTPError.isError(error);
	const { status = 500, statusText = "" } = unhandled ? {} : error;
	if (status === 404) {
		const url = event.url || new URL(event.req.url);
		const baseURL = "/";
		if (/^\/[^/]/.test(baseURL) && !url.pathname.startsWith(baseURL)) return {
			status: 302,
			headers: new Headers({ location: `${baseURL}${url.pathname.slice(1)}${url.search}` })
		};
	}
	const headers = new Headers(unhandled ? {} : error.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	return {
		status,
		statusText,
		headers,
		body: {
			error: true,
			...unhandled ? {
				status,
				unhandled: true
			} : typeof error.toJSON === "function" ? error.toJSON() : {
				status,
				statusText,
				message: error.message
			}
		}
	};
}
//#endregion
//#region #nitro/virtual/error-handler
var errorHandlers = [errorHandler];
async function error_handler_default(error, event) {
	for (const handler of errorHandlers) try {
		const response = await handler(error, event, { defaultHandler });
		if (response) return response;
	} catch (error) {
		console.error(error);
	}
}
//#endregion
//#region #nitro/virtual/app
function createNitroApp() {
	const captureError = (error, errorCtx) => {
		if (errorCtx?.event) {
			const errors = errorCtx.event.req.context?.nitro?.errors;
			if (errors) errors.push({
				error,
				context: errorCtx
			});
		}
	};
	const h3App = createH3App({ onError(error, event) {
		return error_handler_default(error, event);
	} });
	let appHandler = (req) => {
		req.context ||= {};
		req.context.nitro = req.context.nitro || { errors: [] };
		return h3App.fetch(req);
	};
	return {
		fetch: appHandler,
		h3: h3App,
		hooks: void 0,
		captureError
	};
}
function createH3App(config) {
	const h3App = new H3Core(config);
	h3App["~findRoute"] = (event) => findRoute(event.req.method, event.url.pathname);
	h3App["~middleware"].push(...globalMiddleware);
	return h3App;
}
//#endregion
//#region node_modules/nitro/dist/runtime/internal/app.mjs
var APP_ID = "default";
function useNitroApp() {
	let instance = useNitroApp._instance;
	if (instance) return instance;
	instance = useNitroApp._instance = createNitroApp();
	globalThis.__nitro__ = globalThis.__nitro__ || {};
	globalThis.__nitro__[APP_ID] = instance;
	return instance;
}
//#endregion
//#region node_modules/nitro/dist/runtime/internal/error/hooks.mjs
function _captureError(error, type) {
	console.error(`[${type}]`, error);
	useNitroApp().captureError?.(error, { tags: [type] });
}
function trapUnhandledErrors() {
	process.on("unhandledRejection", (error) => _captureError(error, "unhandledRejection"));
	process.on("uncaughtException", (error) => _captureError(error, "uncaughtException"));
}
//#endregion
//#region #nitro/virtual/tracing
var tracingSrvxPlugins = [];
//#endregion
//#region node_modules/nitro/dist/presets/node/runtime/node-server.mjs
var _parsedPort = Number.parseInt(process.env.NITRO_PORT ?? process.env.PORT ?? "");
var port = Number.isNaN(_parsedPort) ? 3e3 : _parsedPort;
var host = process.env.NITRO_HOST || process.env.HOST;
var cert = process.env.NITRO_SSL_CERT;
var key = process.env.NITRO_SSL_KEY;
var nitroApp = useNitroApp();
serve({
	port,
	hostname: host,
	tls: cert && key ? {
		cert,
		key
	} : void 0,
	fetch: nitroApp.fetch,
	plugins: [...tracingSrvxPlugins]
});
trapUnhandledErrors();
var node_server_default = {};
//#endregion
export { node_server_default as default, isPredictionPath as t };
