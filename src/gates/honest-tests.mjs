// Gate `honest-tests` (G1, DS-059 §4.2, step 6.152; workspace non-negotiable 9, DS-013 §4.2.2): the greppable ways a test
// bends around product behaviour. The first five rules are the canonical form of the copies the repos used to keep
// (step 6.142); the rest are new: `real-clock` and `unseeded-random` fail, the others are `reportOnly` (shown, never failing) until each repo ratchets them. A text scan with
// no dependencies: output is file paths, rule names and counts.
// shortcut: the `loosened-threshold` rule needs the diff, so it is not here; it is a follow-up for the baseline guard.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'reports']);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)(?:e2e|test|tests|__tests__)\/.*\.[cm]?[jt]sx?$/;
const CONFIG_FILE =
  /(?:^|\/)(?:vitest|vite|playwright)(?:\.[\w-]+)*\.config\.[cm]?[jt]s$|(?:^|\/)vitest\.workspace\.[cm]?[jt]s$/;
const SPEC = /^\s*\/\/\s*spec:\s*(?:DS-\d{3}|REQ-[A-Z]+-\d{3}|ADR-\d{4})\b[^\n]*§\s*\d/;
const REMOVAL = /\b(?:rmSync|rm|rmdir|unlinkSync)\s*\([^;]*$/;
const NOT_EXPECT = '(?:(?!expect\\()[\\s\\S])';
const TIMERS = '(?:runOnlyPendingTimers|advanceTimersToNextTimer)(?:Async)?';
// A file that freezes or injects the clock itself (fake timers, setSystemTime, mockdate, Playwright page.clock) is trusted.
const CLOCK_FROZEN =
  /\b(?:useFakeTimers|setSystemTime|mockdate|MockDate)\b|\bmock\.timers\.enable\b|\bclock\.(?:install|setFixedTime|setSystemTime)\b/;
const DATE_LITERAL = /['"`]20\d\d-\d\d-\d\d/;
const SPEC_ALLOW = 'a `// spec: <ID> §<n>` comment on the line above, naming the spec that allows it.';

export const HONEST_RULES = {
  'wait-for-timeout': {
    why: 'a fixed wait hides a race instead of fixing it. Workspace rule 9, DS-013 §4.2.2.',
    fix: 'wait for the condition (expect(locator).toBeVisible(), expect.poll).',
  },
  'real-time-wait': {
    why: 'a real-time wait hides a race instead of fixing it. Workspace rule 9, DS-013 §4.2.2.',
    fix: 'use a fake clock (vi.useFakeTimers) or wait for the condition (findBy…, expect.poll).',
  },
  'forced-interaction': {
    why: 'force: true clicks what a user could not, so the test passes on a broken page. Workspace rule 9.',
    fix: 'make the element actionable (wait for it, close what covers it) and interact normally.',
  },
  'outcome-set': {
    why: 'accepting several outcomes means the test cannot fail on the wrong one. Workspace rule 9.',
    fix: 'assert the one outcome the spec names.',
    allow: SPEC_ALLOW,
  },
  'open-status': {
    why: 'an open-ended status range passes on every error the spec does not allow. Workspace rule 9.',
    fix: 'assert the exact status the spec names.',
    allow: SPEC_ALLOW,
  },
  'real-clock': {
    why: 'a test that reads the real clock next to a hard-coded calendar date is a time bomb: it fails once the real day passes the date. DS-059 §4.2.',
    fix: 'freeze or inject the clock (vi.useFakeTimers + vi.setSystemTime, or pass `now`).',
  },
  'unseeded-random': {
    why: 'Math.random in a test makes a failure unrepeatable. DS-059 §4.2.',
    fix: 'use a fixed value or a seeded generator.',
  },
  'bare-tick': {
    why: 'an empty act or an extra timer tick is "one more turn to get past a race". DS-059 §4.2.',
    fix: 'wait for the condition the test needs (findBy…, expect.poll, vi.waitFor).',
    reportOnly: true,
  },
  'microtask-or-frame-wait': {
    why: 'waiting a microtask or a frame hides a race instead of fixing it. DS-059 §4.2.',
    fix: 'wait for the condition (findBy…, expect.poll) or drive the fake clock.',
    reportOnly: true,
  },
  'raised-timeout': {
    why: 'a larger timeout makes a slow or racing test pass. DS-059 §4.2.',
    fix: 'fix why the test is slow; a real-work cause is recorded in the baseline.',
    reportOnly: true,
  },
  'retry-config': {
    why: 'a retry turns a flaky test green. DS-013 Q-119, DS-059 §4.2.',
    fix: 'fix the flake; Playwright allows retries of 1 only with failOnFlakyTests: true.',
    reportOnly: true,
  },
};

const rule = (id, re, extra = {}) => ({ id, re, ...extra });
const FILE_RULES = [
  rule('wait-for-timeout', /\bwaitForTimeout\s*\(/g, { skip: (f) => f.startsWith('e2e/perf/') }),
  // Not Playwright's per-test timeout (test.setTimeout: raised-timeout), not the perf harness, not the measured-quiet helper.
  rule('real-time-wait', /(?<!\btest\.)\bsetTimeout\s*\(|from\s+['"](?:node:)?timers\/promises['"]/g, {
    skip: (f) => f.startsWith('e2e/perf/') || f === 'test/settle.ts',
  }),
  rule('forced-interaction', /\bforce\s*:\s*true\b/g, { ignoreBefore: REMOVAL }),
  rule(
    'outcome-set',
    new RegExp(
      `\\bexpect\\(\\s*\\[${NOT_EXPECT}{0,200}?\\]\\s*(?:,${NOT_EXPECT}{0,120}?)?\\)\\s*\\.toContain\\(|\\bexpect\\(\\s*\\[[^()]{0,200}?\\]\\s*\\.includes\\([^()]*\\)\\s*\\)\\s*\\.toBe\\(true\\)|\\bexpect\\((?:(?!=>)[^;]){0,100}(?:===|==)(?:(?!=>)[^;]){0,100}\\|\\|(?:(?!=>)[^;]){0,100}\\)\\s*\\.toBe\\(true\\)`,
      'g',
    ),
    { spec: true },
  ),
  rule(
    'open-status',
    /\bexpect\([^;\n]*\bstatus\b[^;\n]*\)\s*\.(?:toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual)\(\s*[2-5]\d\d\s*\)|\bexpect\([^;\n]*\bstatus\s*[<>]=?\s*[2-5]\d\d[^;\n]*\)\s*\.toBe\(true\)/g,
    { spec: true },
  ),
  // shortcut: a clock read alone (relative offsets) passes; only a file that also hard-codes a date is flagged, since that
  // pairing is the time bomb (api #1029). Widen when a bomb slips past.
  rule('real-clock', /\bnew\s+Date\(\s*\)|\bDate\.now\(\s*\)/g, { unless: CLOCK_FROZEN, when: DATE_LITERAL }),
  rule('unseeded-random', /\bMath\.random\(\s*\)/g),
  rule(
    'bare-tick',
    new RegExp(
      `\\bact\\(\\s*(?:async\\s*)?\\(\\)\\s*=>\\s*(?:\\{\\s*\\}|undefined)\\s*\\)|\\.advanceTimersByTime\\(\\s*0\\s*\\)|(?:vi|jest)\\.${TIMERS}\\(\\s*\\)\\s*;?\\s*(?:await\\s+)?(?:vi|jest)\\.${TIMERS}\\(`,
      'g',
    ),
  ),
  rule(
    'microtask-or-frame-wait',
    /\bsetImmediate\s*\(|\bqueueMicrotask\s*\(|\bprocess\.nextTick\s*\(|\brequestAnimationFrame\s*\(/g,
  ),
  // A test-level timeout: the last argument of it/test (`}, 30_000);`, four digits or more), an it/test options object
  // `{ timeout: N }`, test.setTimeout, vi.setConfig. A timeout on one assertion or action is not a test-level timeout.
  rule(
    'raised-timeout',
    /^\s*\}\s*,\s*\d[\d_]{3,}\s*\)\s*;?\s*$|\b(?:it|test)(?:\.\w+)*\(\s*(?:'[^'\n]*'|"[^"\n]*"|`[^`\n]*`)\s*,\s*\{\s*timeout\s*:\s*\d|\btest\.setTimeout\s*\(|\bsetConfig\(\s*\{[^}]*testTimeout/gm,
  ),
  // Retries set inside a test file: test.describe.configure({ retries: N }) or an options object { retry: N }.
  rule(
    'retry-config',
    /\.configure\(\s*\{[^}]*\bretr(?:y|ies)\s*:\s*[1-9]|\b(?:it|test)(?:\.\w+)*\(\s*(?:'[^'\n]*'|"[^"\n]*"|`[^`\n]*`)\s*,\s*\{\s*retry\s*:\s*[1-9]/g,
  ),
];
// shortcut: a config timeout is counted, not compared with a recorded value; the baseline holds today's count and shrinks.
const CONFIG_RULES = [
  rule('raised-timeout', /\b(?:testTimeout|hookTimeout|timeout)\s*:\s*\d/g),
  // Vitest `retry: N` (N above 0).
  rule('retry-config', /\bretry\s*:\s*[^,\n}]*[1-9]/g),
];

// Playwright `retries`: above 1, or 1 or more without failOnFlakyTests: true (site's `retries: 0` is fine).
function retries(text) {
  const values = [...text.matchAll(/\bretries\s*:\s*([^,\n]*)/g)].map((m) =>
    Math.max(0, ...(m[1].match(/\d+/g) ?? []).map(Number)),
  );
  const strict = /\bfailOnFlakyTests\s*:\s*true\b/.test(text);
  return values.filter((n) => n > 1 || (n >= 1 && !strict)).length;
}

/** The counts `{ rule: n }` of one file's text. `file` is a path under the repo root with `/` separators. */
export function scanText(file, text) {
  const n = {};
  const lines = text.split('\n');
  const add = (id, by = 1) => by && (n[id] = (n[id] ?? 0) + by);
  if (TEST_FILE.test(file))
    for (const r of FILE_RULES) {
      if (r.skip?.(file) || r.unless?.test(text) || (r.when && !r.when.test(text))) continue;
      for (const m of text.matchAll(r.re)) {
        if (r.ignoreBefore?.test(text.slice(Math.max(0, m.index - 160), m.index))) continue;
        const line = text.slice(0, m.index).split('\n').length;
        if (r.spec && SPEC.test(lines[line - 2] ?? '')) continue;
        add(r.id);
      }
    }
  if (CONFIG_FILE.test(file)) {
    for (const r of CONFIG_RULES) add(r.id, [...text.matchAll(r.re)].length);
    add('retry-config', retries(text));
  }
  return n;
}

function* walk(root, dir = '') {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(root, path);
    } else yield path;
  }
}

export function find({ root }) {
  const found = {};
  let tests = 0;
  for (const file of walk(root)) {
    const isTest = TEST_FILE.test(file);
    if (!isTest && !CONFIG_FILE.test(file)) continue;
    if (isTest) tests += 1;
    const counts = scanText(file, readFileSync(join(root, file), 'utf8'));
    if (Object.keys(counts).length) found[file] = counts;
  }
  // A check that scanned nothing would pass without checking anything: a broken gate, never "no findings".
  if (!tests) throw new Error('no test file was found');
  return found;
}

export const honestTests = { rules: HONEST_RULES, baseline: 'quality/baselines/honest-tests.json', find };
