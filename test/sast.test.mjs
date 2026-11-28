// Tests for the sast gate (step 6.157, DS-059 §4.1): the scan reader, fingerprints, the modes and the issue filer.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { main } from '../src/cli.mjs';
import { countsOf, fileIssues, findingsOf, makeGate, semgrepJson } from '../src/sast.mjs';

const root = mkdtempSync(join(tmpdir(), 'sast-'));
after(() => rmSync(root, { recursive: true, force: true }));
const write = (file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};
write('src/a.ts', 'const a = 1;\neval(x);\nconst r = Math.ran' + 'dom();\n');
write('quality/gates.json', JSON.stringify({ sast: { mode: 'ratchet' } }));

const result = (id, line, severity) => ({
  check_id: `node_modules.@jmal1.aurum-gates.sast.rules.${id}`,
  path: './src/a.ts',
  start: { line },
  extra: { severity, message: `msg of ${id}`, metadata: { cwe: 'CWE-1', fix: 'fix it' } },
});
const JSON_OUT = {
  results: [result('aurum.no-eval', 2, 'ERROR'), result('aurum.math-random', 3, 'WARNING')],
  errors: [],
};
const fake = (json, extra = {}) => ({ spawn: () => ({ status: 1, stdout: JSON.stringify(json), ...extra }) });

describe('reading a scan', () => {
  it('strips the rule directory from the id and counts per file and rule', () => {
    const findings = findingsOf(JSON_OUT, { root });
    assert.deepEqual(
      findings.map((f) => [f.rule, f.path, f.line, f.severity]),
      [
        ['aurum.no-eval', 'src/a.ts', 2, 'ERROR'],
        ['aurum.math-random', 'src/a.ts', 3, 'WARNING'],
      ],
    );
    assert.deepEqual(countsOf(findings), { 'src/a.ts': { 'aurum.no-eval': 1, 'aurum.math-random': 1 } });
  });

  it('keeps a fingerprint when the line moves, and changes it when the line changes', () => {
    const [before] = findingsOf({ results: [result('aurum.no-eval', 2, 'ERROR')] }, { root });
    write('src/a.ts', 'const a = 1;\n\n\neval(x);\n');
    const [moved] = findingsOf({ results: [result('aurum.no-eval', 4, 'ERROR')] }, { root });
    assert.equal(moved.fingerprint, before.fingerprint);
    write('src/a.ts', 'const a = 1;\neval(y);\n');
    const [edited] = findingsOf({ results: [result('aurum.no-eval', 2, 'ERROR')] }, { root });
    assert.notEqual(edited.fingerprint, before.fingerprint);
    write('src/a.ts', 'const a = 1;\neval(x);\nconst r = Math.ran' + 'dom();\n');
  });

  it('is a broken gate when semgrep is missing, silent or reports an error', () => {
    assert.throws(
      () => semgrepJson(root, { spawn: () => ({ error: { code: 'ENOENT' } }) }),
      /could not start \(ENOENT\)/,
    );
    assert.throws(() => semgrepJson(root, { spawn: () => ({ status: 2, stdout: '' }) }), /exited 2 without JSON/);
    assert.throws(
      () => semgrepJson(root, fake({ results: [], errors: [{ level: 'error', type: 'Syntax error' }] })),
      /1 error\(s\), such as Syntax error/,
    );
    assert.deepEqual(semgrepJson(root, fake({ results: [], errors: [{ level: 'warn' }] })).results, []);
  });
});

describe('the gate in its modes', () => {
  const gates = (json) => ({ sast: makeGate(fake(json)) });
  const baseline = (counts) => write('quality/baselines/sast.json', JSON.stringify(counts));

  it('passes at the baseline and fails on a new ERROR finding', async () => {
    baseline({ 'src/a.ts': { 'aurum.no-eval': 1, 'aurum.math-random': 1 } });
    assert.equal((await main(['run', 'sast'], { root, gates: gates(JSON_OUT) })).code, 0);
    baseline({ 'src/a.ts': { 'aurum.math-random': 1 } });
    const failed = await main(['run', 'sast'], { root, gates: gates(JSON_OUT) });
    assert.equal(failed.code, 1);
    assert.match(failed.text, /GATE sast ✗ src\/a\.ts {2}aurum\.no-eval/);
    assert.match(failed.text, /nosemgrep: aurum\.no-eval -- <reason>/);
  });

  it('shows a WARNING finding but never fails on it', async () => {
    baseline({ 'src/a.ts': { 'aurum.no-eval': 1 } });
    const out = await main(['run', 'sast'], { root, gates: gates(JSON_OUT) });
    assert.equal(out.code, 0);
    assert.match(out.text, /aurum\.math-random/);
    assert.match(out.text, /2 finding\(s\)|1 finding\(s\), 0 failing/);
  });

  it('forgives a new ERROR finding in report mode and fails an unreadable scan in every mode', async () => {
    write('quality/gates.json', JSON.stringify({ sast: { mode: 'report' } }));
    baseline({});
    assert.equal((await main(['run', 'sast'], { root, gates: gates(JSON_OUT) })).code, 0);
    const broken = { sast: makeGate({ spawn: () => ({ status: 2, stdout: '' }) }) };
    assert.equal((await main(['run', 'sast'], { root, gates: broken })).code, 2);
    write('quality/gates.json', JSON.stringify({ sast: { mode: 'ratchet' } }));
  });
});

describe('one issue per fingerprint', () => {
  const findings = findingsOf(JSON_OUT, { root });
  const fakeGh = (existing = []) => {
    const calls = [];
    const gh = (args) => {
      calls.push(args);
      if (args[1] === 'list')
        // Like gh: only the fields asked for with --json come back.
        return {
          status: 0,
          stdout: JSON.stringify(
            existing.map((e) =>
              Object.fromEntries(
                args[args.indexOf('--json') + 1].split(',').map((k) => [k, k === 'title' ? `SAST x [${e}]` : 1]),
              ),
            ),
          ),
        };
      return { status: 0, stdout: '' };
    };
    return { gh, calls };
  };

  it('opens an issue for an ERROR finding only, with no code in it', () => {
    const { gh, calls } = fakeGh();
    const lines = fileIssues({ findings, repo: 'o/r', runUrl: 'https://run', gh });
    assert.equal(lines.length, 1);
    const create = calls.find((c) => c[1] === 'create');
    assert.match(create[create.indexOf('--title') + 1], /^SAST aurum\.no-eval in src\/a\.ts \[[0-9a-f]{12}\]$/);
    assert.ok(!create.join(' ').includes('eval(x)'));
  });

  it('skips a fingerprint that has an issue in any state, and defers past the cap', () => {
    const [{ fingerprint }] = findings;
    const { gh, calls } = fakeGh([fingerprint]);
    assert.deepEqual(fileIssues({ findings, repo: 'o/r', gh }), []);
    assert.ok(!calls.some((c) => c[1] === 'create'));
    assert.ok(calls[0].includes('all'));
    const many = Array.from({ length: 27 }, (_, i) => ({
      ...findings[0],
      fingerprint: `f${String(i).padStart(11, '0')}`,
    }));
    const lines = fileIssues({ findings: many, repo: 'o/r', gh: fakeGh().gh });
    assert.equal(lines.filter((l) => l.startsWith('opened')).length, 25);
    assert.equal(lines.filter((l) => l.startsWith('deferred')).length, 2);
  });

  it('ignores a search hit whose title lacks the exact fingerprint', () => {
    const { gh, calls } = fakeGh(['aaaaaaaaaaaa']);
    fileIssues({ findings, repo: 'o/r', gh });
    assert.ok(calls.some((c) => c[1] === 'create'));
  });

  it('fails loudly when gh fails', () => {
    assert.throws(() => fileIssues({ findings, repo: 'o/r', gh: () => ({ status: 1 }) }), /gh issue list failed/);
  });
});
