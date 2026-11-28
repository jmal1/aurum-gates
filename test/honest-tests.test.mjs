// Tests for the `honest-tests` gate (G1, step 6.152): each rule has a failing and a passing case, and the allowance.
// Rule markers are built by concatenation so this file passes its own check (no baseline of fixtures).
// The "parity" cases are the ones the repos' own copies tested (step 6.142), so deleting those copies loses nothing.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { main } from '../src/cli.mjs';
import { HONEST_RULES, scanText } from '../src/gates/honest-tests.mjs';

const wait = 'page.wait' + 'ForTimeout(500);';
const sleep = 'await new Pro' + 'mise((r) => set' + 'Timeout(r, 40));';
const bare = 'set' + 'Timeout(done, 5);';
const force = "await page.click('#a', { fo" + 'rce: true });';
const outcomes = 'expect([200, 412]).to' + 'Contain(res.status);';
const status = 'expect(res.status).toBeGreater' + 'ThanOrEqual(500);';
const spec = '// spec: DS-002 §4.8';
const tick = 'await act(async () => {' + '});';
const hits = (text, file = 'src/a.test.ts') => scanText(file, text);
const root = mkdtempSync(join(tmpdir(), 'gates-honest-'));
after(() => rmSync(root, { recursive: true, force: true }));
const put = (file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};

describe('honest-tests: the canonical rules', () => {
  it('flags waitForTimeout, except in e2e/perf', () => {
    assert.deepEqual(hits(wait), { 'wait-for-timeout': 1 });
    assert.deepEqual(hits(wait, 'e2e/perf/a.spec.ts'), {});
    assert.deepEqual(hits(wait, 'apps/y/e2e/perf/m.ts'), { 'wait-for-timeout': 1 });
  });
  it('flags a real-time wait in every spelling', () => {
    assert.deepEqual(hits(sleep), { 'real-time-wait': 1 });
    assert.deepEqual(hits('await new Pro' + 'mise((r) =>\n  set' + 'Timeout(r, 40));'), { 'real-time-wait': 1 });
    assert.deepEqual(hits('import { set' + "Timeout as sleep } from 'node:timers/" + "promises';"), {
      'real-time-wait': 1,
    });
    assert.deepEqual(hits('latest.set' + 'Timeout(1);'), { 'real-time-wait': 1 });
  });
  it('skips the perf harness and the settle helper, at the repo root only', () => {
    assert.deepEqual(hits(bare, 'e2e/perf/measure.ts'), {});
    assert.deepEqual(hits(bare, 'test/settle.ts'), {});
    for (const nested of ['src/test/other.ts', 'apps/x/test/settle.ts', 'src/test/settle.ts', 'apps/y/e2e/perf/m.ts'])
      assert.deepEqual(hits(bare, nested), { 'real-time-wait': 1 }, nested);
  });
  it('flags a forced interaction, not the force flag of rm', () => {
    assert.deepEqual(hits(force), { 'forced-interaction': 1 });
    assert.deepEqual(hits('rmSync(out, { recursive: true, fo' + 'rce: true });'), {});
    assert.deepEqual(hits('rm(out, {\n  recursive: true,\n  fo' + 'rce: true,\n});'), {});
  });
  it('flags the spellings of an outcome set', () => {
    for (const code of [
      outcomes,
      'expect([a[0], b]).to' + 'Contain(x);',
      "expect(['a', 'b'], label).to" + 'Contain(x);',
      'expect([200, 412].inc' + 'ludes(s)).toBe(true);',
      'expect(s === 200 || s === 412).to' + 'Be(true);',
    ])
      assert.deepEqual(hits(code), { 'outcome-set': 1 }, code);
  });
  it('does not flag what is not an outcome set', () => {
    for (const code of [
      "expect([...objects.values()].filter((o) => ['a', 'b'].inc" + 'ludes(o.kind)).length).toBe(0);',
      'expect([200, 404]).not.to' + 'Contain(res.status);',
      'expect(list).to' + 'Contain(1);',
      "expect(items.every((c) => c.kind === 'a' || c.kind === 'b')).toBe(true);",
      "expect(['a', 'b'].inc" + 'ludes(key)).toBe(!other.inc' + 'ludes(key));',
    ])
      assert.deepEqual(hits(code), {}, code);
  });
  it('flags an open-ended status', () => {
    assert.deepEqual(hits(status), { 'open-status': 1 });
    assert.deepEqual(hits('expect(res.status).toBeLess' + 'Than(500);'), { 'open-status': 1 });
    assert.deepEqual(hits('expect(res.status >= 500).to' + 'Be(true);'), { 'open-status': 1 });
    assert.deepEqual(hits('expect(res.status).toBe(500);'), {});
    assert.deepEqual(hits('expect(elapsed).toBeLess' + 'Than(500);'), {});
  });
  it('allows an outcome set or a status range only with a spec comment right above', () => {
    assert.deepEqual(hits(`${spec}\n${outcomes}`), {});
    assert.deepEqual(hits(`// spec: REQ-DLV-021 §4\n${outcomes}`), {});
    assert.deepEqual(hits(`${spec}\n${status}`), {});
    assert.deepEqual(hits(`// spec: x § y\n${outcomes}`), { 'outcome-set': 1 });
    assert.deepEqual(hits(`const a = 1; // spec: DS-002 §4\n${outcomes}`), { 'outcome-set': 1 });
    assert.deepEqual(hits(`${spec}\n\n${outcomes}`), { 'outcome-set': 1 });
    assert.deepEqual(hits(`${spec}\n${force}`), { 'forced-interaction': 1 });
    assert.deepEqual(
      hits(`// honest-tests: a reason
${force}`),
      { 'forced-interaction': 1 },
    );
    assert.deepEqual(hits(`// honest-tests: a reason\n${outcomes}`), { 'outcome-set': 1 });
  });
  it('does not scan a file that is not a test', () => {
    assert.deepEqual(hits(bare, 'src/a.ts'), {});
  });
});

describe('honest-tests: the new rules', () => {
  it('flags a bare tick', () => {
    assert.deepEqual(hits(tick), { 'bare-tick': 1 });
    assert.deepEqual(hits('act(() => unde' + 'fined);'), { 'bare-tick': 1 });
    assert.deepEqual(hits('vi.advanceTimers' + 'ByTime(0);'), { 'bare-tick': 1 });
    const run = 'vi.runOnlyPending' + 'Timers();';
    assert.deepEqual(hits(`${run}\n${run}`), { 'bare-tick': 1 });
    assert.deepEqual(hits(`${run}\nexpect(a).toBe(1);\n${run}`), {});
    assert.deepEqual(hits('await act(async () => { await go(); });\nvi.advanceTimersByTime(10);'), {});
  });
  it('flags a real-clock read next to a hard-coded date, unless the file freezes the clock', () => {
    const now = 'const at = new ' + 'Date();';
    const dated = "const due = '2026-12-31';";
    assert.deepEqual(
      hits(`${now}
${dated}`),
      { 'real-clock': 1 },
    );
    assert.deepEqual(
      hits(
        `const t = Date.` +
          `now();
${dated}`,
      ),
      { 'real-clock': 1 },
    );
    assert.deepEqual(hits(now), {});
    assert.deepEqual(
      hits(`${dated}
const at = new Date(due);`),
      {},
    );
    assert.deepEqual(
      hits(
        `vi.useFake` +
          `Timers();
${now}
${dated}`,
      ),
      {},
    );
    assert.deepEqual(
      hits(
        `vi.setSystem` +
          `Time(due);
${now}
${dated}`,
      ),
      {},
    );
    assert.deepEqual(
      hits(
        `${now}
${dated}`,
        'src/a.ts',
      ),
      {},
    );
  });
  it('flags an unseeded random', () => {
    assert.deepEqual(hits('const n = Math.ran' + 'dom();'), { 'unseeded-random': 1 });
    assert.deepEqual(hits('const n = seeded();'), {});
  });
  it('flags a microtask or frame wait', () => {
    for (const code of [
      'await new Pro' + 'mise((r) => set' + 'Immediate(r));',
      'queue' + 'Microtask(f);',
      'process.next' + 'Tick(f);',
      'request' + 'AnimationFrame(f);',
    ])
      assert.deepEqual(hits(code), { 'microtask-or-frame-wait': 1 }, code);
    assert.deepEqual(hits('await findByText("x");'), {});
  });
  it('flags a test-level timeout, not the timeout of one assertion', () => {
    assert.deepEqual(hits("it('a', async () => {\n  x();\n}, 30_000);"), { 'raised-timeout': 1 });
    assert.deepEqual(hits("test('a', { time" + 'out: 60000 }, async () => {});'), { 'raised-timeout': 1 });
    assert.deepEqual(hits('test.set' + 'Timeout(9);'), { 'raised-timeout': 1 });
    assert.deepEqual(hits('vi.setConfig({ testTime' + 'out: 9000 });'), { 'raised-timeout': 1 });
    assert.deepEqual(hits("it('a', async () => {\n  x();\n});"), {});
    assert.deepEqual(hits('await expect(page.locator("a")).toBeVisible({ time' + 'out: 10000 });'), {});
    assert.deepEqual(hits('items.reduce((a, b) => {\n  return a + b;\n}, 0);'), {});
  });
  it('flags retries inside a test file', () => {
    assert.deepEqual(hits('test.describe.configure({ retr' + 'ies: 2 });'), { 'retry-config': 1 });
    assert.deepEqual(hits('test.describe.configure({ mode: "serial" });'), {});
    assert.deepEqual(hits("it('a', { re" + 'try: 2 }, () => {});'), { 'retry-config': 1 });
    assert.deepEqual(hits("it('a', { retry: 0 }, () => {});"), {});
    assert.deepEqual(hits('expect(opts).toEqual({ re' + 'try: 1 });'), {});
  });
  it('flags a config timeout and retries', () => {
    const c = (text) => hits(text, 'vitest.config.ts');
    assert.deepEqual(c('export default { test: { testTimeout: 20000 } };'), { 'raised-timeout': 1 });
    assert.deepEqual(c('export default { test: { re' + 'try: 2 } };'), { 'retry-config': 1 });
    assert.deepEqual(c('export default { test: { retry: process.env.CI ? 2 : 0 } };'), { 'retry-config': 1 });
    assert.deepEqual(c('export default { test: { retry: 0 } };'), {});
    const p = (text) => hits(text, 'apps/web/playwright.config.ts');
    assert.deepEqual(p('export default { retries: 2, failOnFlakyTests: true };'), { 'retry-config': 1 });
    assert.deepEqual(p('export default { retries: 1 };'), { 'retry-config': 1 });
    assert.deepEqual(p('export default { retries: process.env.CI ? 1 : 0, failOnFlakyTests: true };'), {});
    assert.deepEqual(p('export default { retries: 0 };'), {});
  });
});

describe('honest-tests: the command', () => {
  it('fails in enforce on a canonical rule, never on a report-only rule', async () => {
    put('quality/gates.json', JSON.stringify({ 'honest-tests': { mode: 'enforce' } }));
    put('a.test.ts', `${tick}\n`);
    const clean = await main(['run', 'honest-tests'], { root });
    assert.equal(clean.code, 0);
    assert.match(clean.text, /bare-tick/);
    put('b.test.ts', `${wait}\n`);
    const result = await main(['run', 'honest-tests'], { root });
    assert.equal(result.code, 1);
    assert.match(result.text, /GATE honest-tests ✗ b\.test\.ts {2}wait-for-timeout/);
  });
  it('exits 0 in report mode with an enforced rule hit (a repo whose fix step has not merged)', async () => {
    const rep = mkdtempSync(join(tmpdir(), 'gates-honest-report-'));
    mkdirSync(join(rep, 'quality/baselines'), { recursive: true });
    writeFileSync(join(rep, 'quality/gates.json'), JSON.stringify({ 'honest-tests': { mode: 'report' } }));
    writeFileSync(join(rep, 'quality/baselines/honest-tests.json'), '{}');
    writeFileSync(
      join(rep, 'a.test.ts'),
      `${wait}
`,
    );
    const result = await main(['run', 'honest-tests'], { root: rep });
    assert.equal(result.code, 0);
    assert.match(result.text, /wait-for-timeout/);
    rmSync(rep, { recursive: true, force: true });
  });
  it('is a broken gate, not a pass, when no test file exists', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'gates-honest-empty-'));
    mkdirSync(join(empty, 'quality'));
    writeFileSync(join(empty, 'quality/gates.json'), JSON.stringify({ 'honest-tests': { mode: 'report' } }));
    assert.equal((await main(['run', 'honest-tests'], { root: empty })).code, 2);
    rmSync(empty, { recursive: true, force: true });
  });
  it('has a why and a fix for every rule', () => {
    for (const r of Object.values(HONEST_RULES)) assert.ok(r.why && r.fix);
  });
});
