# @jmal1/aurum-gates

Quality-gate mechanics for the Aurum repos (DS-059 §4.1, step 6.151): gate modes, shrink-only baselines, the one failure
message and the baseline guard. Zero runtime dependencies, plain ESM, Node ≥ 22.12. Owning spec: DS-059. Working in this
repo with Claude Code: see `CLAUDE.md`.

## Install (no token)

```json
"@jmal1/aurum-gates": "https://codeload.github.com/aurum-education/aurum-gates/tar.gz/refs/tags/vX.Y.Z"
```

then `pnpm install`. A repo pins one exact tag and bumps it in its own PR. The tarball's integrity is **not** in
pnpm's lockfile for a URL dependency, so a tag is never moved (see `CLAUDE.md`); a repository ruleset on `refs/tags/v*` that blocks update and deletion enforces it (owner setting). The `install-probe` job in `pr.yml` repeats the pnpm version of `packageManager`: change both together.

## Use

| Command                                                                                                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aurum-gates run <gate> [--report]`                                                                     | Runs a gate of `src/gates/` in its mode from `quality/gates.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `aurum-gates init <gate>`                                                                               | Writes the gate's first baseline from today's findings, only when the file does not exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `aurum-gates tighten <gate>`                                                                            | Lowers the gate's baseline to today's findings; never raises it (`pnpm gates:tighten` in a repo)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `aurum-gates baseline-guard [--base <ref>] [--report=<label>]`                                          | Fails when a baseline count rises, a key is added or a mode moves backwards, unless the PR body allows it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `aurum-gates run sast`                                                                                  | Semgrep with Aurum's own rules (see SAST below); needs `semgrep` on the PATH                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `aurum-gates sast-issues`                                                                               | Nightly: opens one issue per new ERROR fingerprint (`GH_TOKEN` with issues write, `GITHUB_REPOSITORY`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `aurum-gates pr-evidence [--all]`                                                                       | Posts the `pr-evidence` commit status on a PR's head SHA (see below); `--all` does every open PR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `aurum-gates flake-record --repo <r> --sha <s> --run <url> <firstDir> <lastDir>`                        | Step 6.156 slice 1: one JSON line per test that failed in the first attempt's JUnit reports and passed in the last (`kind: test`), or one `kind: infra` line when the failed attempt names no failed test. IDs only, never message text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `aurum-gates flake-hunt --repo <owner/name> [--days <n>] [--workflow <file>] [--dry-run]`               | Step 6.156 slice 2: reads the repo's recent `pr.yml` runs (needs `GITHUB_TOKEN` with `actions: read`, `issues: write`), finds runs that failed then passed on rerun of the same sha, compares attempt 1's reports with the passing attempt's (`test-reports-attempt-<n>` and each e2e shard's `e2e-junit-shard-<k>-attempt-<n>`; a rerun of only the failed shards is compared too), and opens one `flaky` issue per flaky test (title `flaky: <test id>`; an open issue with that title is the dedupe; no comments). Infra-only reruns are counted, not filed. Workflow: `templates/flake-hunt.yml`. `--init-ledger` writes `quality/baselines/flaky-ledger.json` (`{ test: { issue } }`) once, from the first hunt, and never overwrites it. With a ledger present the hunt names flakes it lacks and ledger tests past 2 school days; exit 1 for them unless `flake-hunt` is in `report` mode in `quality/gates.json` (default report; a repo with no `flake-hunt` entry in `quality/gates.json` is in report) |
| `aurum-gates regression-proof --test "<path>::<name>" [--base <ref>] [--runner vitest\|playwright]`     | Step 6.154 (DS-059 §4.3): for a `type: fix` PR, undoes the PR's source changes (keeps the named test and its test-support paths), runs only that test and requires an assertion failure on the base, then a pass on the head. A compile or import error, a timeout, a missing test or a pass on the base fails with the reason; `none — <reason>` is listed and runs nothing. Run it on a clean CI checkout with `fetch-depth: 0` (it ends with `git reset --hard`). Mode: `regression-proof` in `quality/gates.json` (report for 14 days in web and api, then enforce)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `aurum-gates flake-probe [--base <ref>] [--runner vitest\|playwright] [--cap <n>] [--grep-invert <re>]` | Step 6.156 slice 3 (DS-059 §4.4): runs the test files the PR adds or changes 5 times each under Vitest `--sequence.shuffle` with a different seed, or once with Playwright `--repeat-each=3 --retries=0`; a failure names the test id and the seed, never message text. More than 8 files skips with a notice; no changed file runs nothing. The consumer wiring PR runs it once in report mode on a real repo before anyone trusts it, and its ledger file needs the baseline guard's new-file allowance (the PR adds the gate to `quality/gates.json`). Mode: `flake-probe` in `quality/gates.json` (report for 14 days, then enforce)                                                                                                                                                                                                                                                                                                                                                                          |

Exit codes: 0 clean (findings in `report` mode included), 1 findings, 2 the gate could not run (bad command, crash,
missing or broken file; every mode).

A repo's own gate script imports the helpers:

```js
import { countFailures, finish, runGate } from '@jmal1/aurum-gates';

finish(
  await runGate({
    gate: 'my-gate', // its mode comes from quality/gates.json
    rules: { 'my-rule': { why: '… REQ-X-001.', fix: '…', allow: 'a `// spec: <ID> §<n>` comment' } },
    check: ({ root, mode }) =>
      countFailures({
        root,
        mode,
        baselineFile: 'quality/baselines/my-gate.json',
        found /* { where: { rule: count } } */,
      }),
  }),
);
```

## Files in the consuming repo

- `quality/gates.json`: `{ "<gate>": { "mode": "report" | "ratchet" | "enforce" } }`. A mode only moves right.
- `quality/baselines/<gate>.json`: `{ "<file or ID>": { "<rule>": count } }`. Counts compare two-way: a rise fails, and a
  fall fails with "lower the baseline" (`aurum-gates tighten`). Nothing here raises a baseline.
- Timing ceilings (`ceilingFailures`) compare one-way: only a reading above its ceiling fails.

## The baseline guard

Compares the watched files with the merge base. A finding is allowed only by a line in the PR body,
`baseline-raise: <label> — <reason>`, where the label is the gate name (`<gate> mode` for a mode moved back). The
reviewer reads the line. A baseline file may first appear only in the PR that adds its gate to `quality/gates.json`. A
moved source file (git rename detection) carries its count: a rename with an equal or lower count is neutral.

A repo that watches more files passes a `config` (see `DEFAULT_CONFIG` in `src/guard.mjs`), as aurum-web does for its UX
gates (DS-060 §4.5).

## SAST (`sast`, assurance assessment 2026-11-27 step 2)

Semgrep OSS (free, runs in the job, no service) with our own 14 rules in `sast/rules/aurum.yml`, shipped in the tag:
`eval`, `new Function`, string timers, shell `exec`, `shell: true`, TLS verification off, HTML sinks, JWT `none` or
unverified decode, request bodies in logs (ERROR, these block in `ratchet` and `enforce`) and `Math.random`, MD5 and
SHA-1, RegExp from a variable, `postMessage` to `*` (WARNING: counted and shown, never block). CodeQL is not used: on a
private repo it needs the paid GitHub Code Security add-on.

- Add `"sast": { "mode": "report" }` to `quality/gates.json`, an empty `quality/baselines/sast.json` (`{}`), a
  `.semgrepignore` for generated code, and copy `.github/workflows/sast.yml` (pin the same `SEMGREP_VERSION`). Tests,
  e2e, fixtures and `node_modules` are skipped by the gate itself. Counts are per file and rule, shrink-only like every gate.
- Triage a finding by fixing it, or by `// nosemgrep: <rule id> -- <reason>` on the line above; the reviewer reads the reason.
- The nightly `sast-issues` opens one issue per fingerprint (rule, file and the normalised matched line, so a moved line
  keeps it), at most 25 a night. A closed issue is never opened again. Issues hold rule, path and line, never code.
  Nothing writes a PR comment.
- `aurum.child-process-shell` and `aurum.log-request-body` match by name (`exec` imported from `child_process`, or a receiver
  called `cp`, `child_process`, `childProcess` or `proc`; a logger called `log`, `logger` or `*Logger`). A differently named
  receiver is missed: name it in the rule, with a fixture, when one turns up.
- Rules are tested with `semgrep --test --config sast/rules sast/rules` (a `ruleid` and an `ok` case per rule in
  `sast/rules/aurum.tsx`). Moving the pinned Semgrep version is its own PR.
- Semgrep OSS matches within one file; it does not follow data across files. It is one layer, with the ESLint ban list,
  osv-scanner and gitleaks.

## Strict lint and ban list (`lint-bans`, `suppressions`)

Two gates, shrink-only like every count gate: `aurum-gates init <gate>` writes the first baseline (only when the file is
absent), `run` fails on a rise or a fall, `tighten` lowers.

- `lint-bans` counts the findings of `bans()` (`@jmal1/aurum-gates/eslint`): `no-eval`, `no-new-func`, `no-implied-eval`,
  `Math.random`, `child_process` (import and `require`), and, when the repo passes the plugins, `any`, unsafe and non-literal
  regexes (`eslint-plugin-security`) and the type-aware rules (`no-floating-promises`, `no-misused-promises`,
  `no-unsafe-*`). The config is its own ESLint pass, every rule a warning, so it never clashes with the repo's own
  `eslint.config.js`. The repo lists `eslint`, `typescript-eslint` and `eslint-plugin-security` itself (zero dependencies here).
- `suppressions` is a text scan of non-test source: `any`, `@ts-ignore`/`-nocheck`/`-expect-error`, `eslint-disable`, and each
  directive without a reason (at least 10 characters: ` -- <reason>` after an `eslint-disable`, any text after a `@ts-` directive).

```js
// eslint.bans.config.mjs
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';
import { bans } from '@jmal1/aurum-gates/eslint';
export default bans({
  parser: tseslint.parser,
  plugin: tseslint.plugin,
  security,
  typeAware: true,
  allow: { 'no-restricted-imports': ['scripts/**'] }, // an allowlist; the reason goes in a comment beside it
});
```

`package.json`: `"lint:bans": "rm -f reports/eslint-bans.json; eslint -c eslint.bans.config.mjs -f json -o reports/eslint-bans.json . ; aurum-gates run lint-bans"`
(inline `eslint-disable` comments are ignored in this pass, so a disable cannot hide a ban; the `suppressions` gate counts them). `quality/gates.json` needs `lint-bans` and `suppressions`.

## Truthful tests (`honest-tests`, G1, step 6.152)

One gate replaces the `scripts/check-honest-tests.mjs` copy of every repo: `"check:honest-tests": "aurum-gates run honest-tests"`.
It scans test files (`*.test.*`, `*.spec.*`, `e2e/`, `test/`, `tests/`, `__tests__/`) and the Vitest and Playwright config files.
Rules that fail in the repo's mode: `wait-for-timeout`, `real-time-wait`, `forced-interaction`, `outcome-set` and `open-status`
(the last two allowed by `// spec: <ID> �<n>` on the line above), plus `real-clock` (a test reads `new Date()` or `Date.now()` and hard-codes a `20YY-MM-DD` date, without fake timers, `setSystemTime` or `clock.install` in the file: a time bomb) and `unseeded-random` (`Math.random()`). Report-only rules (shown, never failing, until the repo ratchets
them): `bare-tick`, `microtask-or-frame-wait`, `raised-timeout`, `retry-config`. Findings are counted per file and rule. A repo with
no test file is a broken gate. `loosened-threshold` needs the diff and is not built yet.

## PR evidence (`pr-evidence`, step 6.153)

Checks a PR's body and review markers and posts the commit status `pr-evidence` on its head SHA (DS-059 §4.8). It needs
`GITHUB_TOKEN`, `GITHUB_REPOSITORY` and `PR_NUMBER` (or `--all`), a checkout of the base branch with its history, and the
gate's mode in `quality/gates.json` (`"pr-evidence": { "mode": "report" }`). It never runs PR code.

- The body starts with the two attribution lines, has one `type:` (`fix | feature | refactor | docs | chore | log`) and a
  `step:` line (a `log` needs no step); a `fix` has `regression-test: <path>::<test name>` naming a file the diff changes, or
  `none — <reason>`.
- A PR comment from the owner's account whose first line is `independent-review: pass <full sha>` is a marker. It counts
  when the diff of that SHA, Markdown files left out, has the same `git patch-id --stable` as the head's: a rebase keeps it,
  a code change drops it, a Markdown-only change keeps it. A later `fail` for the same code fails the status.
- `quality/visible-paths.json` (a list of globs) names the paths a person sees; a diff touching one also needs
  `design-review: pass <sha>`. A spec change that adds a spec, changes its `status:` or touches more than 40 lines needs the
  spec ID after the SHA (`independent-review: pass <sha> DS-099`).
- A `type: feature` PR touching a visible path also needs `guide: <audience>/<slug>` (the guide it adds or updates, such as
  `teacher/assign-test`) or `guide: none — <reason>` (DS-049 §4.9). Fixes, refactors, docs and log PRs need none.
- A `type: log` PR touching only `vault/50-Implementation/` and the Changelog needs no review marker.
- `evidence-exempt: <reason>` in the body passes a hand-made PR (listed in the job summary); a bot author passes.
- In `report` the status is green and its description lists what is missing; in `ratchet` or `enforce` it is red. No PR
  comment is written. The job exits 0 unless it could not run (2).

`.github/workflows/pr-evidence.yml` is the workflow (`pull_request_target`, `issue_comment` on a marker, and a manual run
for every open PR before a ruleset first requires the status). Other repos copy it, replacing the last step with an
install of the pinned tag (`npm install --prefix "$RUNNER_TEMP/gates" --ignore-scripts <tarball>`).

## Invariants

1. A gate that cannot run fails in every mode (DS-059 §4.1 rollout rule 5).
2. Every failure uses the one message: `GATE … ✗`, Why, Fix, Allow, Mode.
3. Output is IDs, rule names, counts, paths and timings; no page or test content.
4. There is no command that raises a baseline.

## Test

`pnpm test` (`node --test`). Each rule has a case that must fail and one that must pass; the guard's CLI runs against a
temporary git repository.

## Release

The `version` in `package.json` on `main` is a release: `release.yml` runs the checks and tags `vX.Y.Z` if no tag has
that name. A tag is never moved.

## Where things live

Moved from `CLAUDE.md` so the always-loaded file stays small (context reduction, 2026-11-27).

| Path                                 | Contents                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `bin/aurum-gates.mjs`, `src/cli.mjs` | The CLI: `run`, `tighten`, `init`, `baseline-guard`, `pr-evidence`, `flake-record`, `flake-hunt`, `flake-probe`, `regression-proof`  |
| `src/gate.mjs`                       | Modes, count and ceiling compare, failure message, `runGate`, `finish`                                                               |
| `src/guard.mjs`                      | The baseline guard engine and its default watched files                                                                              |
| `src/evidence.mjs`                   | `pr-evidence`: the PR body and review-marker rules, the commit status                                                                |
| `src/flakes.mjs`                     | `flake-record`: tests that failed then passed between two attempts' JUnit reports, IDs only (G3, step 6.156)                         |
| `src/hunt.mjs`                       | `flake-hunt`: rerun-passed PR runs to one `flaky` issue per test, IDs only (G3, step 6.156 slice 2)                                  |
| `src/ledger.mjs`                     | The flaky ledger (`quality/baselines/flaky-ledger.json`): school-day SLO, verdict for the nightly (G3, step 6.156 slice 3)           |
| `src/probe.mjs`                      | `flake-probe`: changed test files repeated under shuffled seeds on the PR, test ID and seed only (G3, step 6.156 slice 3)            |
| `src/proof.mjs`                      | `regression-proof`: the named test must fail with an assertion on the base and pass on the head (G2, step 6.154)                     |
| `src/sast.mjs`, `sast/rules/`        | The `sast` gate (Semgrep with our own rules, `sast-issues`) and the rules with their test cases                                      |
| `src/tighten.mjs`                    | `tighten`: baselines move down only                                                                                                  |
| `src/eslint.mjs`, `src/gates/`       | The ban-list ESLint config (`bans()`), the `lint-bans` and `suppressions` gates, and the registry of gates (each gate step adds one) |
| `test/`, `test/fixtures/`            | Tests (`node:test`) and the fixture repo root                                                                                        |
| `docs/adr/`                          | Repo-local ADRs                                                                                                                      |
| `.github/workflows/`                 | `pr.yml` (checks, install probe), `pr-evidence.yml` (the `pr-evidence` status), `release.yml` (tags `vX.Y.Z` from `main`)            |
