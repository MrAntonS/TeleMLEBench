export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "TeleMLEBench release and evaluation API",
    version: "1.0.0",
    description: "Immutable public split downloads and private hidden-label evaluation. A returned score is not automatically a public reproduction result.",
  },
  servers: [{ url: "/api/v1" }],
  tags: [
    { name: "Releases", description: "Public immutable 70/15/15 task releases." },
    { name: "Evaluations", description: "Authenticated private prediction evaluation." },
  ],
  paths: {
    "/releases": {
      get: {
        tags: ["Releases"],
        summary: "List published task releases",
        parameters: [
          { name: "dataset_id", in: "query", schema: { type: "string" } },
          { name: "dataset_version_id", in: "query", schema: { type: "string" } },
          { name: "dataset", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Published releases", content: { "application/json": { schema: { $ref: "#/components/schemas/ReleaseList" } } } } },
      },
    },
    "/releases/{releaseId}": {
      get: {
        tags: ["Releases"],
        summary: "Get a published release",
        parameters: [{ $ref: "#/components/parameters/ReleaseId" }],
        responses: { "200": { description: "Release", content: { "application/json": { schema: { $ref: "#/components/schemas/Release" } } } }, "404": { description: "Not found" } },
      },
    },
    "/releases/{releaseId}/manifest": {
      get: {
        tags: ["Releases"],
        summary: "Get the public normalized manifest and checksums",
        parameters: [{ $ref: "#/components/parameters/ReleaseId" }],
        responses: { "200": { description: "Public manifest", content: { "application/json": { schema: { $ref: "#/components/schemas/Release" } } } } },
      },
    },
    "/releases/{releaseId}/files/{role}": {
      get: {
        tags: ["Releases"],
        summary: "Download a public split artifact",
        parameters: [
          { $ref: "#/components/parameters/ReleaseId" },
          { name: "role", in: "path", required: true, schema: { type: "string", enum: ["train", "validation", "test_features", "split_assignment"] } },
        ],
        responses: { "307": { description: "Redirect to the immutable public artifact" }, "404": { description: "Role or release not found" } },
      },
    },
    "/evaluations/uploads": {
      post: {
        tags: ["Evaluations"],
        summary: "Issue a constrained private Vercel Blob upload token",
        security: [{ bearerAuth: [] }, {}],
        description: "Implements the @vercel/blob client-upload protocol. SDK clients authenticate with an API key. Browser clients include a Cloudflare Turnstile response in clientPayload and receive a short-lived evaluation grant. Upload tokens are path-, type-, size-, and time-constrained.",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "Vercel Blob client token and, for CAPTCHA clients, a scoped evaluation grant" }, "401": { description: "Invalid API key" }, "403": { description: "Human verification failed" } },
      },
    },
    "/evaluations/config": {
      get: {
        tags: ["Evaluations"],
        summary: "Get public browser evaluation configuration",
        responses: { "200": { description: "Turnstile site key and availability; no secret values" } },
      },
    },
    "/evaluations": {
      post: {
        tags: ["Evaluations"],
        summary: "Start hidden-label evaluation of a private upload",
        security: [{ bearerAuth: [] }],
        description: "Accepts either an SDK API key or the browser grant returned by the upload-token response. Browser grants are bound to the exact release and private pathname.",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EvaluationRequest" } } } },
        responses: { "202": { description: "Durable evaluation queued", content: { "application/json": { schema: { $ref: "#/components/schemas/EvaluationAccepted" } } } }, "400": { description: "Invalid upload" }, "401": { description: "Invalid or expired evaluation credential" } },
      },
    },
    "/evaluations/{evaluationId}": {
      get: {
        tags: ["Evaluations"],
        summary: "Get durable evaluation status or score",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "evaluationId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Terminal evaluation and private result" }, "202": { description: "Evaluation still running" }, "401": { description: "Invalid or expired evaluation credential" }, "404": { description: "Evaluation not found for this credential" } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "TeleMLEBench API key or scoped browser grant" },
    },
    parameters: {
      ReleaseId: { name: "releaseId", in: "path", required: true, schema: { type: "string" } },
    },
    schemas: {
      ReleaseFile: {
        type: "object",
        required: ["role", "logical_path", "media_type", "byte_size", "sha256", "download_endpoint"],
        properties: {
          role: { type: "string" }, logical_path: { type: "string" }, media_type: { type: "string" },
          byte_size: { type: "integer", minimum: 0 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          download_endpoint: { type: "string" },
        },
      },
      Release: {
        type: "object",
        required: ["id", "dataset_id", "dataset_version_id", "dataset_aliases", "task_id", "status", "split", "files", "evaluation"],
        properties: {
          id: { type: "string" }, dataset_id: { type: "string" }, dataset_version_id: { type: "string" },
          dataset_aliases: { type: "array", items: { type: "string" } },
          task_id: { type: "string" }, release_version: { type: "string" }, status: { const: "published" },
          target_fields: { type: "array", items: { type: "string" } },
          split: { type: "object" }, files: { type: "array", items: { $ref: "#/components/schemas/ReleaseFile" } },
          manifest_endpoint: { type: "string" }, evaluation: { type: "object" },
        },
      },
      ReleaseList: {
        type: "object",
        required: ["items", "total", "errors"],
        properties: { items: { type: "array", items: { $ref: "#/components/schemas/Release" } }, total: { type: "integer" }, errors: { type: "array", items: { type: "object" } } },
      },
      EvaluationRequest: {
        type: "object",
        required: ["release_id", "prediction"],
        properties: {
          release_id: { type: "string" },
          prediction: { type: "object", required: ["pathname", "size"], properties: { pathname: { type: "string" }, size: { type: "integer", minimum: 1 } } },
        },
      },
      EvaluationAccepted: {
        type: "object",
        required: ["evaluation_id", "release_id", "status", "status_endpoint"],
        properties: { evaluation_id: { type: "string" }, release_id: { type: "string" }, status: { const: "queued" }, status_endpoint: { type: "string" } },
      },
    },
  },
} as const;
