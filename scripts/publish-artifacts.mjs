#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promoteTennis, promoteWnba, rollback, validateTennis, validateWnba } from './publication-lib.mjs';

function argsToObject(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 1) {
    if (!values[i].startsWith('--') || !values[i + 1]) throw new Error(`Invalid argument: ${values[i]}`);
    result[values[i].slice(2)] = values[++i];
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
    const result = promoteTennis({ repoRoot, manifestPath: requireArg(args, 'manifest'), profilePath: requireArg(args, 'profile'), historyPath: requireArg(args, 'history') });
    console.log(`PROMOTED tennis release=${result.releaseId} snapshot=${result.validation.manifest.SnapshotID}`); return;
  }
  if (command === 'publish' && sport === 'wnba') {
    const result = promoteWnba({ repoRoot, profilePath: requireArg(args, 'profile') });
    console.log(`PROMOTED wnba release=${result.releaseId} profiles=${result.validation.profiles}`); return;
  }
  if (command === 'rollback' && ['tennis', 'wnba'].includes(sport)) {
    const result = rollback({ repoRoot, sport, releaseId: args.release || '' });
    console.log(`ROLLED BACK ${result.sport} release=${result.releaseId}`); return;
  }
  throw new Error('Usage: validate|publish tennis --manifest <path> --profile <path> --history <path>; validate|publish wnba --profile <path>; rollback tennis|wnba --release <id>');
}

main().catch((error) => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
