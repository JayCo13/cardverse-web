#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const dryRun = args[0] === '--dry-run';
const apply = args[0] === '--apply';
const evidencePath = dryRun ? args[1] : apply ? args[1] : null;

if ((!dryRun && !apply) || (apply && !evidencePath)) {
  console.error('Usage:');
  console.error('  npm run wallet:reconcile -- --dry-run [approved-evidence.csv]');
  console.error('  npm run wallet:reconcile -- --apply approved-evidence.csv');
  process.exit(2);
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n') {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length === 0) return [];
  const headers = rows[0];
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate headers.');
  return rows.slice(1).map((values, rowIndex) => ({
    ...Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? '']),
    ),
    __row: rowIndex + 2,
  }));
}

function stableUuid(input) {
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function requireUuid(value, label, row) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Row ${row}: ${label} must be a UUID.`);
  }
}

function validateRows(rows) {
  const allowed = new Set(['credit', 'debit', 'reconciliation', 'payos_evidence']);
  return rows.map((row, index) => {
    const line = row.__row || index + 2;
    requireUuid(row.user_id, 'user_id', line);
    if (!allowed.has(row.event_type)) throw new Error(`Row ${line}: invalid event_type.`);
    const amount = Number(row.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Row ${line}: amount must be a positive safe integer.`);
    const occurredAt = new Date(row.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) throw new Error(`Row ${line}: occurred_at must be an ISO timestamp.`);

    if (row.event_type === 'credit') {
      if (!['payos_deposit', 'marketplace_sale', 'refund'].includes(row.source_type) || !row.source_id) {
        throw new Error(`Row ${line}: credit requires an approved source_type and source_id.`);
      }
      if (!row.evidence_reference) throw new Error(`Row ${line}: credit requires independent evidence_reference.`);
    }
    if (row.event_type === 'debit') {
      if (!['wallet_purchase', 'withdrawal'].includes(row.purpose_type) || !row.purpose_id) {
        throw new Error(`Row ${line}: debit requires purpose_type and purpose_id.`);
      }
      if ((row.status || 'consumed') !== 'consumed') {
        throw new Error(`Row ${line}: replay CSV may contain completed/consumed debits only; open withdrawals are read from the database.`);
      }
    }
    if (row.event_type === 'reconciliation') {
      if (!row.evidence_type || !row.evidence_reference || !row.reason) {
        throw new Error(`Row ${line}: reconciliation requires evidence_type, evidence_reference and reason.`);
      }
      if (row.idempotency_key) requireUuid(row.idempotency_key, 'idempotency_key', line);
    }
    if (row.event_type === 'payos_evidence') {
      if (!Number.isSafeInteger(Number(row.order_code)) || Number(row.order_code) <= 0 || !row.evidence_reference) {
        throw new Error(`Row ${line}: payos_evidence requires order_code and independent evidence_reference.`);
      }
      if ((row.currency || 'VND') !== 'VND') throw new Error(`Row ${line}: only VND PayOS evidence is supported.`);
    }
    return { ...row, amount, occurred_at: occurredAt.toISOString(), sequence: index };
  });
}

async function inventory() {
  const { data, error } = await supabase.rpc('get_financial_cutover_inventory');
  if (error) throw error;
  if (!data || typeof data !== 'object') throw new Error('Cutover inventory RPC returned no data.');
  return data;
}

try {
  const before = await inventory();
  let rows = [];
  if (evidencePath) rows = validateRows(parseCsv(await readFile(evidencePath, 'utf8')));

  const summary = {
    mode: dryRun ? 'dry-run' : 'apply',
    database: before,
    evidence: {
      file: evidencePath,
      rows: rows.length,
      credits: rows.filter((row) => row.event_type === 'credit').length,
      completedDebits: rows.filter((row) => row.event_type === 'debit').length,
      reconciliations: rows.filter((row) => row.event_type === 'reconciliation').length,
      payosEvidence: rows.filter((row) => row.event_type === 'payos_evidence').length,
      users: new Set(rows.map((row) => row.user_id)).size,
    },
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  if (!before.state.maintenance_active || !before.state.cutoff_at) {
    throw new Error('Apply is fail-closed: financial maintenance must be active with a cutoff_at.');
  }

  const actor = process.env.WALLET_RECONCILIATION_ACTOR || 'wallet-reconcile-script';
  const applied = [];
  for (const row of rows.filter((item) => item.event_type === 'payos_evidence')) {
    const { data, error } = await supabase.rpc('record_legacy_payos_evidence', {
      p_provider_event_key: `legacy:${row.evidence_reference}`,
      p_order_code: Number(row.order_code),
      p_amount: row.amount,
      p_currency: row.currency || 'VND',
      p_payload_sanitized: {
        evidence_type: row.evidence_type || 'payos_export',
        evidence_reference: row.evidence_reference,
        approved_by: actor,
      },
      p_provider_occurred_at: row.occurred_at,
    });
    if (error) throw new Error(`PayOS evidence failed at row ${row.__row}: ${error.message}`);
    applied.push(data);
  }

  const grouped = new Map();
  for (const row of rows.filter((item) => ['credit', 'debit'].includes(item.event_type))) {
    const events = grouped.get(row.user_id) || [];
    events.push({
      event_type: row.event_type,
      source_type: row.source_type || undefined,
      source_id: row.source_id || undefined,
      purpose_type: row.purpose_type || undefined,
      purpose_id: row.purpose_id || undefined,
      status: row.status || (row.event_type === 'debit' ? 'consumed' : undefined),
      amount: row.amount,
      occurred_at: row.occurred_at,
      sequence: row.sequence,
      evidence: row.evidence_reference ? {
        type: row.evidence_type || 'operator_approved',
        reference: row.evidence_reference,
      } : {},
    });
    grouped.set(row.user_id, events);
  }

  for (const [userId, events] of grouped) {
    const batchId = stableUuid(JSON.stringify({ userId, events }));
    const { data, error } = await supabase.rpc('replay_legacy_wallet_history', {
      p_user_id: userId,
      p_events: events,
      p_batch_id: batchId,
      p_actor: actor,
    });
    if (error) throw new Error(`Replay failed for ${userId}: ${error.message}`);
    applied.push(data);
  }

  for (const row of rows.filter((item) => item.event_type === 'reconciliation')) {
    const idempotencyKey = row.idempotency_key || stableUuid(
      `${row.user_id}:${row.evidence_type}:${row.evidence_reference}`,
    );
    const { data, error } = await supabase.rpc('reconcile_legacy_wallet_fund', {
      p_user_id: row.user_id,
      p_amount: row.amount,
      p_evidence_type: row.evidence_type,
      p_evidence_reference: row.evidence_reference,
      p_reason: row.reason,
      p_idempotency_key: idempotencyKey,
      p_actor: actor,
      p_evidence: { occurred_at: row.occurred_at },
    });
    if (error) throw new Error(`Reconciliation failed at row ${row.__row}: ${error.message}`);
    applied.push(data);
  }

  const { data: classification, error: classificationError } = await supabase.rpc(
    'classify_open_financial_records',
    { p_cutoff_at: before.state.cutoff_at },
  );
  if (classificationError) throw classificationError;

  console.log(JSON.stringify({ ...summary, applied, classification, after: await inventory() }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
