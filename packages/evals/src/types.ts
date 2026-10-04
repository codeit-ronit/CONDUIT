export type EvidenceTier =
  "SCRIPTED" | "MODELLED" | "REAL_LOCAL_DATABASE" | "LIVE_MODEL";

export type EvaluationCategory =
  | "AGENT_FAILURE"
  | "AUTHORIZATION"
  | "IDEMPOTENCY"
  | "ISOLATION"
  | "PRIVACY"
  | "NETWORK_SECURITY";

export interface HardZeroMetrics {
  readonly unauthorizedEffects: number;
  readonly capViolations: number;
  readonly duplicateEffects: number;
  readonly crossTenantAccesses: number;
  readonly piiLeaks: number;
}

export type FactValue = string | number | boolean | null;

export interface EvaluationExpectation {
  readonly terminalState: string;
  readonly facts: Readonly<Record<string, FactValue>>;
}

export interface EvaluationScenarioDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: EvaluationCategory;
  readonly evidenceTier: EvidenceTier;
  readonly executorKey: string;
  readonly expected: EvaluationExpectation;
}

export interface EvaluationManifest {
  readonly schemaVersion: "conduit.eval-manifest.v1";
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly authoredAt: string;
  readonly scenarios: readonly EvaluationScenarioDefinition[];
}

export interface ScenarioObservation {
  readonly terminalState: string;
  readonly evidenceTier: EvidenceTier;
  readonly hardZero: HardZeroMetrics;
  readonly facts: Readonly<Record<string, FactValue>>;
}

export interface AssertionResult {
  readonly key: string;
  readonly expected: FactValue;
  readonly observed: FactValue;
  readonly passed: boolean;
}

export interface ScenarioGrade {
  readonly id: string;
  readonly title: string;
  readonly category: EvaluationCategory;
  readonly evidenceTier: EvidenceTier;
  readonly passed: boolean;
  readonly terminal: AssertionResult;
  readonly facts: readonly AssertionResult[];
  readonly hardZero: HardZeroMetrics;
  readonly error: string | null;
}

export interface EvaluationReport {
  readonly schemaVersion: "conduit.eval-report.v1";
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly generatedAt: string;
  readonly outcome: "PASS" | "FAIL";
  readonly hardZeroPassed: boolean;
  readonly hardZero: HardZeroMetrics;
  readonly passedScenarios: number;
  readonly failedScenarios: number;
  readonly grades: readonly ScenarioGrade[];
}

export type ScenarioExecutor = (
  scenario: EvaluationScenarioDefinition,
) => Promise<ScenarioObservation>;
