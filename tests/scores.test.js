import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createScoresApi } from '../server/scores.js';
import { todayInLosAngeles, formatEntryDate } from '../src/lib/scores.js';

const ORIGIN = 'https://goldsmith.example';
const TEST_KEY = 'test-only';
const ENTRY = { date: '2026-10-16', scores: [1, 2, 3, 4, 5, 6] };

function fixture() {
  const bins = new Map();
  const calls = [];
  let key = TEST_KEY;
  let timestamp = Date.parse('2026-10-16T20:00:00Z');
  let failure;
  const logs = [];
  const api = createScoresApi({
    getAccessKey: () => key,
    now: () => timestamp,
    logger: { error: (...args) => logs.push(args) },
    fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      assert.equal(options.headers['X-Access-Key'], TEST_KEY);
      assert.equal(options.headers['X-Master-Key'], undefined);
      assert.ok(url.startsWith('https://api.jsonbin.io/v3/b'));
      assert.equal(options.redirect, 'error');
      if (failure) return failure();
      const id = url.match(/\/b\/([a-f0-9]{24})/)?.[1];
      if (options.method === 'POST') {
        assert.equal(options.headers['X-Bin-Private'], 'true');
        const newId = (bins.size + 1).toString(16).padStart(24, '0');
        bins.set(newId, JSON.parse(options.body));
        return Response.json({ metadata: { id: newId }, record: bins.get(newId) });
      }
      if (!bins.has(id)) return Response.json({ message: 'Not found' }, { status: 404 });
      if (options.method === 'PUT') {
        assert.equal(options.headers['X-Bin-Versioning'], 'false');
        bins.set(id, JSON.parse(options.body));
      }
      return Response.json({ record: bins.get(id), metadata: { id } });
    },
  });
  return {
    api, bins, calls, logs,
    setKey: value => { key = value; },
    setTime: value => { timestamp = value; },
    fail: fn => { failure = fn; },
  };
}

function request(method = 'GET', body, cookie, headers = {}, suffix = '') {
  return new Request(`${ORIGIN}/api/scores${suffix}`, {
    method,
    headers: {
      ...(method === 'POST' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

function cookieOf(response) {
  return response.headers.get('set-cookie')?.split(';')[0];
}

test('new browsers read an empty history without using JSONBin', async () => {
  const f = fixture();
  const response = await f.api(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { entries: [] });
  assert.equal(f.calls.length, 0);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('create, reload, and update execute real handlers; key stays on the upstream hop', async () => {
  const f = fixture();
  const first = await f.api(request('POST', ENTRY));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { entries: [ENTRY] });
  assert.match(first.headers.get('set-cookie'), /__Host-goldsmith=.*HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  assert.ok(!first.headers.get('set-cookie').includes(TEST_KEY));
  const cookie = cookieOf(first);
  const reload = await f.api(request('GET', undefined, cookie));
  assert.deepEqual(await reload.json(), { entries: [ENTRY] });
  const updated = { ...ENTRY, scores: [10, 9, 8, 7, 6, 5] };
  const save = await f.api(request('POST', updated, cookie));
  assert.deepEqual(await save.json(), { entries: [updated] });
  assert.equal(f.bins.size, 1);
  assert.equal(f.calls.at(-1).method, 'PUT');
  assert.equal(JSON.stringify([...f.bins.values()]).includes(TEST_KEY), false);
});

test('different browsers get separate bins and cannot select each other\'s bin', async () => {
  const f = fixture();
  const a = await f.api(request('POST', ENTRY));
  const secondEntry = { ...ENTRY, scores: [null, 10, null, 10, null, 10] };
  const b = await f.api(request('POST', secondEntry));
  assert.notEqual(cookieOf(a), cookieOf(b));
  const aRead = await f.api(request('GET', undefined, cookieOf(a)));
  const bRead = await f.api(request('GET', undefined, cookieOf(b)));
  assert.deepEqual(await aRead.json(), { entries: [ENTRY] });
  assert.deepEqual(await bRead.json(), { entries: [secondEntry] });
  const count = f.calls.length;
  const forged = cookieOf(a).replace('000000000000000000000001', '000000000000000000000002');
  assert.equal((await f.api(request('GET', undefined, forged))).status, 401);
  assert.equal((await f.api(request('GET', undefined, cookieOf(a), {}, '?binId=000000000000000000000002'))).status, 400);
  assert.equal(f.calls.length, count);
});

test('expired, malformed, and duplicate session cookies fail closed', async () => {
  const f = fixture();
  const created = await f.api(request('POST', ENTRY));
  const cookie = cookieOf(created);
  const count = f.calls.length;
  for (const value of ['__Host-goldsmith=anything', `${cookie}; ${cookie}`, `${cookie}x`]) {
    assert.equal((await f.api(request('GET', undefined, value))).status, 401);
  }
  f.setTime(Date.parse('2028-10-16T20:00:00Z'));
  assert.equal((await f.api(request('GET', undefined, cookie))).status, 401);
  assert.equal(f.calls.length, count);
});

test('cross-site and missing-origin writes never reach storage', async () => {
  const f = fixture();
  for (const headers of [{ Origin: 'https://other.example' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await f.api(request('POST', ENTRY, undefined, headers))).status, 403);
  }
  assert.equal(f.calls.length, 0);
});

test('wrong methods, types, malformed JSON, and extra fields are rejected before storage', async () => {
  const f = fixture();
  assert.equal((await f.api(request('DELETE'))).status, 405);
  assert.equal((await f.api(request('POST', ENTRY, undefined, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await f.api(request('POST', '{bad json'))).status, 400);
  assert.equal((await f.api(request('POST', { ...ENTRY, binId: 'anything' }))).status, 400);
  assert.equal(f.calls.length, 0);
});

test('invalid dates and score values are rejected before storage', async () => {
  const f = fixture();
  for (const entry of [
    { ...ENTRY, date: '2026-02-30' },
    { ...ENTRY, date: 'bad-date' },
    { ...ENTRY, scores: [1] },
    { ...ENTRY, scores: [0, 2, 3, 4, 5, 6] },
    { ...ENTRY, scores: [11, 2, 3, 4, 5, 6] },
    { ...ENTRY, scores: ['1', 2, 3, 4, 5, 6] },
    { ...ENTRY, scores: [1.5, 2, 3, 4, 5, 6] },
    { ...ENTRY, scores: Array(6).fill(null) },
  ]) assert.equal((await f.api(request('POST', entry))).status, 400);
  assert.equal(f.calls.length, 0);
});

test('oversized payloads are rejected with and without content-length', async () => {
  const f = fixture();
  assert.equal((await f.api(request('POST', ' '.repeat(1025)))).status, 413);
  assert.equal((await f.api(request('POST', ENTRY, undefined, { 'Content-Length': '2048' }))).status, 413);
  assert.equal(f.calls.length, 0);
});

test('successful saves retain earlier dates instead of replacing history with client data', async () => {
  const f = fixture();
  const first = await f.api(request('POST', ENTRY));
  const next = { ...ENTRY, date: '2026-10-17' };
  const save = await f.api(request('POST', next, cookieOf(first)));
  assert.deepEqual(await save.json(), { entries: [ENTRY, next] });
});

test('missing configuration produces a clear error without a network call', async () => {
  const f = fixture();
  f.setKey('');
  const response = await f.api(request());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /not configured/);
  assert.equal(f.calls.length, 0);
});

test('upstream failures never expose its body or pretend an entry was saved', async () => {
  const f = fixture();
  f.fail(() => Response.json({ secret: TEST_KEY, personalData: 'private' }, { status: 403 }));
  const response = await f.api(request('POST', ENTRY));
  assert.equal(response.status, 502);
  assert.match(await response.text(), /not saved/);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(JSON.stringify(f.logs).includes(TEST_KEY), false);
});

test('network errors are sanitized, including errors that contain credentials', async () => {
  const f = fixture();
  f.fail(() => { throw new Error(TEST_KEY); });
  const response = await f.api(request('POST', ENTRY));
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes(TEST_KEY), false);
  assert.equal(JSON.stringify(f.logs).includes(TEST_KEY), false);
});

test('unrelated or corrupted upstream records are not treated as Goldsmith data', async () => {
  const f = fixture();
  const first = await f.api(request('POST', ENTRY));
  f.bins.set('000000000000000000000001', { entries: [ENTRY] });
  assert.equal((await f.api(request('GET', undefined, cookieOf(first)))).status, 502);
});

test('Los Angeles dates stay correct across UTC midnight and daylight saving', () => {
  assert.equal(todayInLosAngeles(new Date('2026-10-17T02:00:00Z')), '2026-10-16');
  assert.equal(todayInLosAngeles(new Date('2026-10-17T08:00:00Z')), '2026-10-17');
  assert.equal(todayInLosAngeles(new Date('2026-01-01T07:00:00Z')), '2025-12-31');
  assert.equal(formatEntryDate('2026-10-16', 'en-US'), '10/16/2026');
});

test('browser source contains neither JSONBin requests nor any embedded master key', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const client = await readFile(new URL('../src/lib/scores.js', import.meta.url), 'utf8');
  for (const source of [app, client]) {
    assert.equal(/api\.jsonbin\.io|X-(Master|Access)-Key|\$2[aby]\$\d{2}\$/.test(source), false);
    assert.equal(source.includes('process.env'), false);
  }
});
