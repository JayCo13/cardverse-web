import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadGoship(fetch) {
  const code = ts.transpileModule(
    fs.readFileSync(new URL('../src/lib/goship.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, fetch, process, AbortSignal, DOMException, URLSearchParams });
  return exports;
}

test('shipment tracking uses the GoShip search endpoint and returns its exact match', async () => {
  const previousToken = process.env.GOSHIP_API;
  const previousEnv = process.env.GOSHIP_ENV;
  process.env.GOSHIP_API = 'test-token';
  delete process.env.GOSHIP_ENV;

  let requestedUrl = '';
  const goship = loadGoship(async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        status: 'success',
        data: [
          { id: 'OTHER' },
          { id: 'GS6Z3Q1748', expected: '22/09/2026', history: [{ status: 901 }] },
        ],
      }),
    };
  });

  try {
    const result = await goship.goshipShipmentByCode('GS6Z3Q1748');
    assert.equal(requestedUrl, 'https://api.goship.io/api/v2/shipments/search?code=GS6Z3Q1748');
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 'GS6Z3Q1748');
    assert.equal(result.data.expected, '22/09/2026');
  } finally {
    if (previousToken === undefined) delete process.env.GOSHIP_API;
    else process.env.GOSHIP_API = previousToken;
    if (previousEnv === undefined) delete process.env.GOSHIP_ENV;
    else process.env.GOSHIP_ENV = previousEnv;
  }
});

test('shipment tracking retries one transport timeout', async () => {
  const previousToken = process.env.GOSHIP_API;
  const previousEnv = process.env.GOSHIP_ENV;
  process.env.GOSHIP_API = 'test-token';
  delete process.env.GOSHIP_ENV;

  let attempts = 0;
  const goship = loadGoship(async () => {
    attempts += 1;
    if (attempts === 1) {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        status: 'success',
        data: [{ id: 'GS6Z3Q1748', history: [{ status: 901 }] }],
      }),
    };
  });

  try {
    const result = await goship.goshipShipmentByCode('GS6Z3Q1748');
    assert.equal(attempts, 2);
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 'GS6Z3Q1748');
  } finally {
    if (previousToken === undefined) delete process.env.GOSHIP_API;
    else process.env.GOSHIP_API = previousToken;
    if (previousEnv === undefined) delete process.env.GOSHIP_ENV;
    else process.env.GOSHIP_ENV = previousEnv;
  }
});
test('shipment tracking leaves enough serverless time to return stored status', () => {
  const source = fs.readFileSync(new URL('../src/lib/goship.ts', import.meta.url), 'utf8');
  const match = source.match(/goshipShipmentByCode[\s\S]*?timeoutMs:\s*([\d_]+),\s*attempts:\s*(\d+)/);

  assert.ok(match, 'tracking timeout configuration should be explicit');
  const timeoutMs = Number(match[1].replaceAll('_', ''));
  const attempts = Number(match[2]);
  assert.ok(timeoutMs * attempts <= 4_500, 'GoShip must leave time for the degraded JSON response');
});
