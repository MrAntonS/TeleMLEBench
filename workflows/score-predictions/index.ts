import {
  removePredictionStep,
  scorePredictionStep,
  type EvaluationOutcome,
  type ScorePredictionsInput,
} from "./steps";

export async function scorePredictionsWorkflow(
  input: ScorePredictionsInput,
): Promise<EvaluationOutcome> {
  "use workflow";

  let outcome: EvaluationOutcome;
  try {
    outcome = await scorePredictionStep(input);
  } catch {
    outcome = {
      status: "failed",
      release_id: input.releaseId,
      scorer_version: "telemlebench-vercel-accuracy/1",
      alignment: { join_key: "sample_id", mode: "strict_test_order" },
      publication: {
        public: false,
        note: "This is a private server-verified score, not a published reproduction result.",
      },
      error: {
        code: "evaluation_failed",
        message: "The trusted evaluator could not complete this run. The hidden labels were not exposed.",
      },
      completed_at: new Date().toISOString(),
    };
  }
  await removePredictionStep(input.predictionPath);
  return outcome;
}
