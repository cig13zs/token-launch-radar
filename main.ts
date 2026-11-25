// token-radar-01: a pre-token launch radar, read from the sealed snapshot (Node 22, standard library only).
//
// The program reads /input/snapshot.json, ranks every protocol that records no token with the fitted
// value model in dashboard/model.mjs, prices a farm plan for each one with dashboard/farm.mjs, writes the
// board to /output/board.json and the page's own data to /output/data.js, copies this repository's
// dashboard/ and screenshots/ into /output, and writes the judge's dossier last with the vendored
// make.fun library. Two runs on the same snapshot write the same bytes: nothing here reads a clock, and
// every ordering is either the snapshot's own or a stated tie-break on the slug.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from './dashboard/model.mjs';
import { boardIssue, buildRadar, dataScript } from './dashboard/board.mjs';
import { buildDossier, TEXT_FILE } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** Refuse the run loudly: a wrong artifact is worse than no artifact. */
function fail(message) {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

/**
 * The dossier shows every dashboard source file whole only while the whole text fits in 65,536 bytes, and
 * a page past the cap is cut: the judge would then read a partial source and could not check the value
 * model against the board. So the cap is measured here, before anything is written, and the run fails
 * rather than hand in a source the judge sees half of. The figure checked is the sum of the text files
 * plus the headings, fences and cut line buildDossier adds around them.
 */
function assertTextFits(dir) {
  let bytes = 0;
  let files = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile() || !TEXT_FILE.test(name)) continue;
    files += 1;
    bytes += statSync(path).size;
  }
  // Each file's heading, its opening and closing fence and its blank lines, plus the Dashboard block.
  const overhead = 320 + files * 140;
  if (bytes + overhead > TEXT_MAX_BYTES) {
    fail(`the dashboard's ${files} source files come to ${bytes} bytes: with the dossier's headings that is over the ${TEXT_MAX_BYTES}-byte text cap, so the judge would read a cut source. Trim a file.`);
  }
  return bytes + overhead;
}

const textBytes = assertTextFits(join(here, 'dashboard'));

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from, to) {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (pageFiles.length > DASHBOARD_CAPS.max_files) fail(`dashboard/ holds ${pageFiles.length} files, over the ${DASHBOARD_CAPS.max_files} the gate allows`);
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares the bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

const share = (n) => `${((n / board.length) * 100).toFixed(0)}%`;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored ` +
    `(${radar.tier_counts.watchlist} watchlist, ${radar.tier_counts.extended} above the floor outside the house list, ${radar.tier_counts.early} below it)\n` +
    `token radar: model ${radar.model_version} fitted on ${radar.model.n} comps trimmed from ${radar.model.n + radar.model.trimmed}, ` +
    `R2 ${radar.model.r2}, out-of-sample median log error ${radar.validation.rows[0].median_abs_log_error} ` +
    `against ${radar.validation.rows[1].median_abs_log_error} flat and ${radar.validation.rows[2].median_abs_log_error} by category\n` +
    `token radar: farm plans ${radar.verdict_counts.farm} farm (${share(radar.verdict_counts.farm)}), ${radar.verdict_counts.thin} thin, ${radar.verdict_counts.skip} skip\n` +
    `token radar: dossier source text ${textBytes} of ${TEXT_MAX_BYTES} bytes, ${shots.length} screenshots\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${pageFiles.length} files), ${join(out, 'screenshots')}, ${join(out, 'dossier.json')}\n`,
);
