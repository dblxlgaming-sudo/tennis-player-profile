#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promoteTennis, promoteWnba, rollback, validateTennis, validateWnba } from './publication-lib.mjs';
import { productionPublish, productionRollback } from './production-publication.mjs';

function argsToObject(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 1) {
    if (!values[i].startsWith('--')) throw new Error(`Invalid argument: ${values[i]}`);
    const key = values[i].slice(2);
    if (values[i + 1] && !values[i + 1].startsWith('--')) result[key] = values[++i]; else result[key] = true;
  }
  return result;
}

function requireArg(args, name) { if (!args[name]) throw new Error(`Missing required --${name}`); return path.resolve(args[name]); }

async function main() {
  const [command, sport, ...rest] = process.argv.slice(2);
  const args = argsToObject(rest);
  const repoRoot = args.repo ? path.resolve(args.repo) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (command === 'validate' && sport === 'tennis') {
    const result = validateTennis({ manifestPath: requireArg(args, 'manifest'), profilePath: requireArg(args, 'profile'), historyPath: requireArg(args, 'history') });
    console.log(`PASS tennis snapshot=${result.manifest.SnapshotID} profileRows=${result.profileRows} historyRows=${result.historyRows}`); return;
  }
  if (command === 'validate' && sport === 'wnba') {
    const result = validateWnba({ profilePath: requireArg(args, 'profile') });
    console.log(`PASS wnba version=${result.artifact.ProfileVersion} profiles=${result.profiles} coverage=${result.coverage.TrackedDateStart}..${result.coverage.TrackedDateEnd}`); return;
  }
  if (command === 'publish' && sport === 'tennis') {
    const candidates = { manifestPath: requireArg(args, 'manifest'), profilePath: requireArg(args, 'profile'), historyPath: requireArg(args, 'history') };
    if (args.production) { const result = await productionPublish({ sport, candidates, repoRoot, liveUrl: args['live-url'], timeoutMs: args['timeout-seconds'] ? Number(args['timeout-seconds']) * 1000 : undefined }); console.log(`${result.state} tennis release=${result.releaseId} commit=${result.commit} pushed=${result.pushed}`); return; }
    const result = promoteTennis({ repoRoot, ...candidates }); console.log(`PROMOTED tennis release=${result.releaseId} snapshot=${result.validation.manifest.SnapshotID}`); return;
  }
  if (command === 'publish' && sport === 'wnba') {
    const candidates = { profilePath: requireArg(args, 'profile') };
    if (args.production) { const result = await productionPublish({ sport, candidates, repoRoot, liveUrl: args['live-url'], timeoutMs: args['timeout-seconds'] ? Number(args['timeout-seconds']) * 1000 : undefined }); console.log(`${result.state} wnba release=${result.releaseId} commit=${result.commit} pushed=${result.pushed}`); return; }
    const result = promoteWnba({ repoRoot, ...candidates }); console.log(`PROMOTED wnba release=${result.releaseId} profiles=${result.validation.profiles}`); return;
  }
  if (command === 'rollback' && ['tennis', 'wnba'].includes(sport)) {
    if (args.production) { const result = await productionRollback({ repoRoot, sport, releaseId: args.release || '', liveUrl: args['live-url'], timeoutMs: args['timeout-seconds'] ? Number(args['timeout-seconds']) * 1000 : undefined }); console.log(`${result.state} rollback ${result.sport || sport} release=${result.releaseId} commit=${result.commit} pushed=${result.pushed}`); return; }
    const result = rollback({ repoRoot, sport, releaseId: args.release || '' });
    console.log(`ROLLED BACK ${result.sport} release=${result.releaseId}`); return;
  }
  throw new Error('Usage: validate|publish tennis --manifest <path> --profile <path> --history <path>; validate|publish wnba --profile <path>; rollback tennis|wnba --release <id>');
}

main().catch((error) => { console.error(`${error.code || 'FAIL'}: ${error.message}${error.localNewerThanLive ? `; LOCAL is newer than LIVE at ${error.commit}` : ''}`); process.exitCode = 1; });
