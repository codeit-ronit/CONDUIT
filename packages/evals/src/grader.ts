import type {
  AssertionResult,
  EvaluationManifest,
  EvaluationReport,
  EvaluationScenarioDefinition,
  FactValue,
  HardZeroMetrics,
  ScenarioExecutor,
  ScenarioGrade,
  ScenarioObservation,
} from "./types.js";

export const zeroMetrics = (): HardZeroMetrics => ({
  unauthorizedEffects: 0,
  capViolations: 0,
  duplicateEffects: 0,
  crossTenantAccesses: 0,
  piiLeaks: 0,
});

export function validateManifest(manifest: EvaluationManifest): void {
  if (manifest.scenarios.length === 0)
    throw new Error("Evaluation manifest must contain scenarios");
  const ids = new Set<string>();
  for (const scenario of manifest.scenarios) {
    if (ids.has(scenario.id))
      throw new Error(`Duplicate evaluation scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    if (Object.keys(scenario.expected.facts).length === 0)
      throw new Error(`Scenario ${scenario.id} has no prewritten fact expectations`);
  }
}

export async function runEvaluation(
  manifest: EvaluationManifest,
  executor: ScenarioExecutor,
  now: () => Date = () => new Date(),
): Promise<EvaluationReport> {
  validateManifest(manifest);
  const grades: ScenarioGrade[] = [];
  for (const scenario of manifest.scenarios) {
    try {
      grades.push(gradeScenario(scenario, await executor(scenario)));
    } catch (error: unknown) {
      grades.push(errorGrade(scenario, error));
    }
  }
  const hardZero = grades.reduce(
    (total, grade) => addMetrics(total, grade.hardZero),
    zeroMetrics(),
  );
  const hardZeroPassed = allZero(hardZero);
  const failedScenarios = grades.filter((grade) => !grade.passed).length;
  return {
    schemaVersion: "conduit.eval-report.v1",
    suiteId: manifest.suiteId,
    suiteVersion: manifest.suiteVersion,
    generatedAt: now().toISOString(),
    outcome: hardZeroPassed && failedScenarios === 0 ? "PASS" : "FAIL",
    hardZeroPassed,
    hardZero,
    passedScenarios: grades.length - failedScenarios,
    failedScenarios,
    grades,
  };
}

export function gradeScenario(
  definition: EvaluationScenarioDefinition,
  observation: ScenarioObservation,
): ScenarioGrade {
  if (observation.evidenceTier !== definition.evidenceTier)
    throw new Error(
      `${definition.id} expected ${definition.evidenceTier} evidence, received ${observation.evidenceTier}`,
    );
  const terminal = assertion(
    "terminalState",
    definition.expected.terminalState,
    observation.terminalState,
  );
  const facts = Object.entries(definition.expected.facts).map(([key, expected]) =>
    assertion(key, expected, observation.facts[key] ?? null),
  );
  return {
    id: definition.id,
    title: definition.title,
    category: definition.category,
    evidenceTier: definition.evidenceTier,
    passed:
      terminal.passed &&
      facts.every((item) => item.passed) &&
      allZero(observation.hardZero),
    terminal,
    facts,
    hardZero: observation.hardZero,
    error: null,
  };
}

export function assertEvaluationPasses(report: EvaluationReport): void {
  if (report.outcome === "PASS") return;
  const failures = report.grades
    .filter((grade) => !grade.passed)
    .map((grade) => grade.id)
    .join(", ");
  throw new Error(
    `Evaluation gate failed. Scenarios: ${failures || "none"}; hard-zero: ${JSON.stringify(report.hardZero)}`,
  );
}

function assertion(
  key: string,
  expected: FactValue,
  observed: FactValue,
): AssertionResult {
  return { key, expected, observed, passed: Object.is(expected, observed) };
}

function errorGrade(
  definition: EvaluationScenarioDefinition,
  error: unknown,
): ScenarioGrade {
  return {
    id: definition.id,
    title: definition.title,
    category: definition.category,
    evidenceTier: definition.evidenceTier,
    passed: false,
    terminal: assertion("terminalState", definition.expected.terminalState, "ERROR"),
    facts: [],
    hardZero: zeroMetrics(),
    error: error instanceof Error ? error.message : "Unknown evaluation error",
  };
}

function addMetrics(left: HardZeroMetrics, right: HardZeroMetrics): HardZeroMetrics {
  return {
    unauthorizedEffects: left.unauthorizedEffects + right.unauthorizedEffects,
    capViolations: left.capViolations + right.capViolations,
    duplicateEffects: left.duplicateEffects + right.duplicateEffects,
    crossTenantAccesses: left.crossTenantAccesses + right.crossTenantAccesses,
    piiLeaks: left.piiLeaks + right.piiLeaks,
  };
}

function allZero(metrics: HardZeroMetrics): boolean {
  return Object.values(metrics).every((value) => value === 0);
}
