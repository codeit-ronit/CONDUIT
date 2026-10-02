import type {
  AuditEvent,
  BoundaryRepository,
  BoundaryRun,
  ToolApproval,
  ToolClassification,
  ToolDescriptor,
} from "@conduit/enforcement";
import { tenantId } from "@conduit/domain";
import type { TenantId } from "@conduit/domain";
import { auditPayload } from "@conduit/observability";
import type { AuditEntry, JsonValue } from "@conduit/observability";
import type { Pool, PoolClient, QueryResultRow } from "pg";

interface RunRow extends QueryResultRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly trust_state: "CLEAN" | "QUARANTINED";
  readonly quarantine_nonce: string;
  readonly policy_version: "boundary-v1";
}

interface ApprovalRow extends QueryResultRow {
  readonly tenant_id: string;
  readonly provider_id: string;
  readonly tool_name: string;
  readonly classification: ToolClassification;
  readonly schema_hash: string;
  readonly enabled: boolean;
  readonly approved_at: Date;
}

interface HeadRow extends QueryResultRow {
  readonly last_sequence: string;
  readonly last_hash: string;
}

interface HashRow extends QueryResultRow {
  readonly entry_hash: string;
}

interface AuditRow extends QueryResultRow {
  readonly tenant_id: string;
  readonly sequence: string;
  readonly previous_hash: string;
  readonly entry_hash: string;
  readonly canonical_payload: string;
}

export class PostgresBoundaryRepository implements BoundaryRepository {
  public constructor(private readonly pool: Pool) {}

  public async startRun(
    scopedTenantId: TenantId,
    quarantineNonce: string,
  ): Promise<BoundaryRun> {
    const result = await this.pool.query<RunRow>(
      `INSERT INTO conduit.enforcement_runs (
         tenant_id, quarantine_nonce, policy_version
       )
       SELECT id, $2, 'boundary-v1' FROM conduit.tenants WHERE id = $1
       RETURNING id, tenant_id, trust_state, quarantine_nonce, policy_version`,
      [scopedTenantId, quarantineNonce],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Tenant does not exist");
    return mapRun(row);
  }

  public async getRun(scopedTenantId: TenantId, runId: string): Promise<BoundaryRun> {
    const result = await this.pool.query<RunRow>(
      `SELECT id, tenant_id, trust_state, quarantine_nonce, policy_version
       FROM conduit.enforcement_runs WHERE tenant_id = $1 AND id = $2`,
      [scopedTenantId, runId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Enforcement run does not exist");
    return mapRun(row);
  }

  public async markRunQuarantined(
    scopedTenantId: TenantId,
    runId: string,
  ): Promise<BoundaryRun> {
    const result = await this.pool.query<RunRow>(
      `UPDATE conduit.enforcement_runs
       SET trust_state = 'QUARANTINED', updated_at = clock_timestamp()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, tenant_id, trust_state, quarantine_nonce, policy_version`,
      [scopedTenantId, runId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Enforcement run does not exist");
    return mapRun(row);
  }

  public async approveTool(
    scopedTenantId: TenantId,
    descriptor: ToolDescriptor,
    classification: ToolClassification,
    schemaHash: string,
  ): Promise<ToolApproval> {
    const snapshot: JsonValue = {
      providerId: descriptor.providerId,
      name: descriptor.name,
      inputSchema: descriptor.inputSchema,
      outputSchema: descriptor.outputSchema,
    };
    const result = await this.pool.query<ApprovalRow>(
      `INSERT INTO conduit.tool_approvals (
         tenant_id, provider_id, tool_name, classification,
         schema_hash, schema_snapshot, enabled
       )
       SELECT id, $2, $3, $4, $5, $6::jsonb, true
       FROM conduit.tenants WHERE id = $1
       ON CONFLICT (tenant_id, provider_id, tool_name)
       DO UPDATE SET classification = EXCLUDED.classification,
                     schema_hash = EXCLUDED.schema_hash,
                     schema_snapshot = EXCLUDED.schema_snapshot,
                     enabled = true,
                     approved_at = clock_timestamp()
       RETURNING tenant_id, provider_id, tool_name, classification,
                 schema_hash, enabled, approved_at`,
      [
        scopedTenantId,
        descriptor.providerId,
        descriptor.name,
        classification,
        schemaHash,
        JSON.stringify(snapshot),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Tenant does not exist");
    return mapApproval(row);
  }

  public async getToolApproval(
    scopedTenantId: TenantId,
    providerId: string,
    toolName: string,
  ): Promise<ToolApproval | null> {
    const result = await this.pool.query<ApprovalRow>(
      `SELECT tenant_id, provider_id, tool_name, classification,
              schema_hash, enabled, approved_at
       FROM conduit.tool_approvals
       WHERE tenant_id = $1 AND provider_id = $2 AND tool_name = $3`,
      [scopedTenantId, providerId, toolName],
    );
    return result.rows[0] ? mapApproval(result.rows[0]) : null;
  }

  public async appendAudit(
    scopedTenantId: TenantId,
    event: AuditEvent,
  ): Promise<AuditEntry> {
    return this.transaction(async (client) => {
      await client.query(
        `INSERT INTO conduit.audit_heads (tenant_id)
         SELECT id FROM conduit.tenants WHERE id = $1
         ON CONFLICT (tenant_id) DO NOTHING`,
        [scopedTenantId],
      );
      const headResult = await client.query<HeadRow>(
        `SELECT last_sequence::text, last_hash
         FROM conduit.audit_heads WHERE tenant_id = $1 FOR UPDATE`,
        [scopedTenantId],
      );
      const head = headResult.rows[0];
      if (!head) throw new Error("Audit head could not be created");
      const sequenceBigInt = BigInt(head.last_sequence) + 1n;
      if (sequenceBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Audit sequence exceeds JavaScript's safe integer range");
      }
      const sequence = Number(sequenceBigInt);
      const canonicalPayload = auditPayload(auditEventJson(event));
      const hashResult = await client.query<HashRow>(
        `SELECT encode(
           digest(convert_to($1 || E'\\n' || $2 || E'\\n' || $3 || E'\\n' || $4, 'UTF8'), 'sha256'),
           'hex'
         ) AS entry_hash`,
        [scopedTenantId, String(sequence), head.last_hash, canonicalPayload],
      );
      const entryHash = hashResult.rows[0]?.entry_hash;
      if (!entryHash) throw new Error("PostgreSQL did not calculate an audit hash");
      await client.query(
        `INSERT INTO conduit.audit_entries (
           tenant_id, sequence, run_id, call_id, phase, canonical_payload,
           previous_hash, entry_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          scopedTenantId,
          sequence,
          event.runId,
          event.callId,
          event.phase,
          canonicalPayload,
          head.last_hash,
          entryHash,
        ],
      );
      await client.query(
        `UPDATE conduit.audit_heads
         SET last_sequence = $2, last_hash = $3, updated_at = clock_timestamp()
         WHERE tenant_id = $1`,
        [scopedTenantId, sequence, entryHash],
      );
      return {
        tenantId: scopedTenantId,
        sequence,
        previousHash: head.last_hash,
        entryHash,
        canonicalPayload,
      };
    });
  }

  public async listAudit(
    scopedTenantId: TenantId,
    runId?: string,
  ): Promise<readonly AuditEntry[]> {
    const parameters: string[] = runId ? [scopedTenantId, runId] : [scopedTenantId];
    const result = await this.pool.query<AuditRow>(
      `SELECT ae.tenant_id, ae.sequence::text, ae.previous_hash,
              ae.entry_hash, ae.canonical_payload
       FROM conduit.audit_entries ae
       WHERE ae.tenant_id = $1${runId ? " AND ae.run_id = $2" : ""}
       ORDER BY ae.sequence`,
      parameters,
    );
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      sequence: Number(row.sequence),
      previousHash: row.previous_hash,
      entryHash: row.entry_hash,
      canonicalPayload: row.canonical_payload,
    }));
  }

  private async transaction<TResult>(
    operation: (client: PoolClient) => Promise<TResult>,
  ): Promise<TResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error: unknown) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapRun(row: RunRow): BoundaryRun {
  return {
    id: row.id,
    tenantId: tenantId(row.tenant_id),
    trustState: row.trust_state,
    quarantineNonce: row.quarantine_nonce,
    policyVersion: row.policy_version,
  };
}

function mapApproval(row: ApprovalRow): ToolApproval {
  return {
    tenantId: tenantId(row.tenant_id),
    providerId: row.provider_id,
    toolName: row.tool_name,
    classification: row.classification,
    schemaHash: row.schema_hash,
    enabled: row.enabled,
    approvedAt: row.approved_at,
  };
}

function auditEventJson(event: AuditEvent): JsonValue {
  return {
    runId: event.runId,
    callId: event.callId,
    correlationId: event.correlationId,
    phase: event.phase,
    toolName: event.toolName,
    classification: event.classification,
    decision: event.decision,
    reason: event.reason,
    outcome: event.outcome,
    policyVersion: event.policyVersion,
    contextFingerprint: event.contextFingerprint,
    payload: event.payload,
  };
}
