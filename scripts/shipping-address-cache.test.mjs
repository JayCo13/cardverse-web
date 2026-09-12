import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, mocks) {
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    console,
    require: key => {
      if (!(key in mocks)) throw new Error(`Unexpected import ${key}`);
      return mocks[key];
    },
  });
  return exports;
}

const nextServer = {
  NextResponse: {
    json: (body, init = {}) => ({
      body,
      status: init.status ?? 200,
      headers: new Headers(init.headers),
    }),
  },
};

test('district responses are not shared by Netlify across city_code values', async () => {
  const calls = [];
  const route = load('../src/app/api/shipping/address/districts/route.ts', {
    'next/server': nextServer,
    '@/lib/account-route': { accountRoute: handler => handler },
    '@/lib/goship': {
      goshipDistricts: async cityCode => {
        calls.push(cityCode);
        return { ok: true, data: [{ id: `${cityCode}-district`, name: cityCode }] };
      },
    },
  });

  const response = await route.GET({
    nextUrl: new URL('https://example.test/api/shipping/address/districts?city_code=890000'),
  });

  assert.deepEqual(calls, ['890000']);
  assert.equal(response.body.data[0].code, '890000-district');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('ward responses are not shared by Netlify across district_code values', async () => {
  const calls = [];
  const route = load('../src/app/api/shipping/address/wards/route.ts', {
    'next/server': nextServer,
    '@/lib/account-route': { accountRoute: handler => handler },
    '@/lib/goship': {
      goshipWards: async districtCode => {
        calls.push(districtCode);
        return { ok: true, data: [{ id: 11580, name: districtCode }] };
      },
    },
  });

  const response = await route.GET({
    nextUrl: new URL('https://example.test/api/shipping/address/wards?district_code=970100'),
  });

  assert.deepEqual(calls, ['970100']);
  assert.equal(response.body.data[0].name, '970100');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
