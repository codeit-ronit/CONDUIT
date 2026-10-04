import { assertEvaluationPasses, runRedTeamExperiment } from "@conduit/evals";
import { createDatabasePool } from "@conduit/infrastructure";

import { runSafetyEvaluation } from "./evaluation-scenarios.js";

const pool = createDatabasePool();

try {
  const safety = await runSafetyEvaluation(pool);
  const redTeam = runRedTeamExperiment();
  process.stdout.write(`${JSON.stringify({ safety, redTeam }, null, 2)}\n`);
  assertEvaluationPasses(safety);
  if (redTeam.outcome !== "PASS") throw new Error("Red-team causal gate failed");
} finally {
  await pool.end();
}
