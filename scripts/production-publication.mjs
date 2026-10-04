import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { promoteTennis, promoteWnba, rollback, tennisReleaseId, validateTennis, validateWnba, wnbaReleaseId } from './publication-lib.mjs';

export class PublicationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const normalize = (value) => value.replaceAll('\\', '/').replace(/^\.\//, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function acquirePublicationLock(repoRoot, { waitMs = 30000, pollMs = 500 } = {}) {
  const lockPath = path.join(repoRoot, '.git', 'player-profile-publication.lock');
  const deadline = Date.now() + waitMs;
  while (true) {
    try {
      const handle = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      fs.closeSync(handle);
      return () => fs.rmSync(lockPath, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw new PublicationError('GIT_SAFETY_FAILURE', `Cannot acquire publication lock: ${error.message}`);
      if (Date.now() >= deadline) throw new PublicationError('GIT_SAFETY_FAILURE', `Publication lock is busy; retryable after current transaction completes: ${lockPath}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(pollMs, deadline - Date.now()));
    }
  }
}

function canonicalRemote(url) {
  return url.trim().replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();
}

export class RealGit {
  constructor(repoRoot) { this.repoRoot = repoRoot; }
  run(args, options = {}) {
    try { return execFileSync('git', args, { cwd: this.repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trimEnd(); }
    catch (error) { throw new PublicationError(options.code || 'GIT_SAFETY_FAILURE', `${options.label || `git ${args.join(' ')}`} failed: ${(error.stderr || error.message).toString().trim()}`); }
  }
  assertCanonical() {
    const root = path.resolve(this.run(['rev-parse', '--show-toplevel']));
    if (root.toLowerCase() !== path.resolve(this.repoRoot).toLowerCase()) throw new PublicationError('GIT_SAFETY_FAILURE', 'Repository root does not match publisher repository');
    if (this.run(['branch', '--show-current']) !== 'main') throw new PublicationError('GIT_SAFETY_FAILURE', 'Production publication requires branch main');
    const remote = canonicalRemote(this.run(['remote', 'get-url', 'origin']));
    if (remote !== 'https://github.com/dblxlgaming-sudo/tennis-player-profile') throw new PublicationError('GIT_SAFETY_FAILURE', `Unexpected origin remote: ${remote}`);
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
      try { this.run(['rev-parse', '--verify', '-q', marker]); throw new PublicationError('GIT_SAFETY_FAILURE', `Unresolved Git operation: ${marker}`); }
      catch (error) { if (error instanceof PublicationError && error.message.startsWith('Unresolved')) throw error; }
    }
    const gitDir = this.run(['rev-parse', '--git-dir']);
    for (const directory of ['rebase-merge', 'rebase-apply']) if (fs.existsSync(path.resolve(this.repoRoot, gitDir, directory))) throw new PublicationError('GIT_SAFETY_FAILURE', `Unresolved Git operation: ${directory}`);
  }
  statusPaths() {
    const output = this.run(['status', '--porcelain=v1', '-z']);
    if (!output) return [];
    return output.split('\0').filter(Boolean).map((entry) => normalize(entry.slice(3).includes(' -> ') ? entry.slice(3).split(' -> ').at(-1) : entry.slice(3)));
  }
  fetch() { this.run(['fetch', '--no-tags', 'origin', 'main'], { code: 'GIT_SAFETY_FAILURE', label: 'remote synchronization' }); }
  relation() {
    const head = this.run(['rev-parse', 'HEAD']); const remote = this.run(['rev-parse', 'origin/main']);
    if (head === remote) return 'equal';
    try { this.run(['merge-base', '--is-ancestor', remote, head]); return 'ahead'; } catch {}
    try { this.run(['merge-base', '--is-ancestor', head, remote]); return 'behind'; } catch {}
    return 'diverged';
  }
  aheadPaths() { const output = this.run(['diff', '--name-only', 'origin/main..HEAD']); return output ? output.split(/\r?\n/).map(normalize) : []; }
  stage(paths) { this.run(['add', '--', ...paths], { code: 'COMMIT_FAILURE', label: 'stage publication files' }); }
  stagedPaths() { const output = this.run(['diff', '--cached', '--name-only']); return output ? output.split(/\r?\n/).map(normalize) : []; }
  hasStagedChanges() { return Boolean(this.run(['diff', '--cached', '--name-only'])); }
  commit(message) { this.run(['commit', '-m', message], { code: 'COMMIT_FAILURE', label: 'publication commit' }); return this.run(['rev-parse', 'HEAD']); }
  push() { this.run(['push', 'origin', 'main'], { code: 'PUSH_FAILURE', label: 'normal push to origin/main' }); }
  head() { return this.run(['rev-parse', 'HEAD']); }
}

export function expectedPublicationPaths(sport, releaseId, validation) {
  const root = `data/releases/${sport}/${releaseId}`;
  if (sport === 'tennis') return ['data/publication-manifest.json', `${root}/${validation.manifest.Artifacts.PlayerProfile.FileName}`, `${root}/${validation.manifest.Artifacts.PlayerStatCharts.FileName}`, `${root}/publication-receipt.json`];
  return ['data/publication-manifest.json', `${root}/${path.basename(validation.profilePath || 'wnba_player_profiles_v1.json')}`, `${root}/release-metadata.json`];
}

function assertAllowlisted(paths, allowed, label = 'working tree') {
  const allow = new Set(allowed.map(normalize));
  const unexpected = paths.map(normalize).filter((item) => !allow.has(item));
  if (unexpected.length) throw new PublicationError('GIT_SAFETY_FAILURE', `Unexpected ${label} paths: ${unexpected.join(', ')}`);
}

async function fetchBytes(url) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function verifyLivePublication({ liveUrl, sport, releaseId, validation, unaffectedRelease, timeoutMs = 180000, pollMs = 5000 }) {
  const base = liveUrl.endsWith('/') ? liveUrl : `${liveUrl}/`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const manifest = JSON.parse((await fetchBytes(new URL(`data/publication-manifest.json?publication=${Date.now()}`, base))).toString('utf8'));
      if (manifest.sports?.[sport]?.release !== releaseId) { await sleep(pollMs); continue; }
      const other = sport === 'tennis' ? 'wnba' : 'tennis';
      if (manifest.sports?.[other]?.release !== unaffectedRelease) throw new PublicationError('LIVE_HASH_VERIFICATION_FAILURE', `${other} pointer changed unexpectedly`);
      const entry = manifest.sports[sport];
      const artifactUrl = (relative) => new URL(relative.replace(/^\.\//, ''), base);
      if (sport === 'tennis') {
        const [profile, history] = await Promise.all([fetchBytes(artifactUrl(entry.profile)), fetchBytes(artifactUrl(entry.history))]);
        await fetchBytes(artifactUrl(entry.receipt));
        if (crypto.createHash('sha256').update(profile).digest('hex') !== validation.profileHash) throw new PublicationError('LIVE_HASH_VERIFICATION_FAILURE', 'Live Tennis Player Profile SHA-256 mismatch');
        if (crypto.createHash('sha256').update(history).digest('hex') !== validation.historyHash) throw new PublicationError('LIVE_HASH_VERIFICATION_FAILURE', 'Live Tennis history SHA-256 mismatch');
      } else {
        const profile = await fetchBytes(artifactUrl(entry.profile)); await fetchBytes(artifactUrl(entry.metadata));
        if (crypto.createHash('sha256').update(profile).digest('hex') !== validation.hash) throw new PublicationError('LIVE_HASH_VERIFICATION_FAILURE', 'Live WNBA profile SHA-256 mismatch');
      }
      await fetchBytes(base); await fetchBytes(new URL('app.js', base));
      return { manifest, verifiedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof PublicationError) throw error;
      if (Date.now() + pollMs > deadline) break;
      await sleep(pollMs);
    }
  }
  throw new PublicationError('PAGES_DEPLOYMENT_TIMEOUT', `Live release ${releaseId} was not verified within ${timeoutMs}ms`);
}

export async function productionPublish({ sport, candidates, repoRoot, liveUrl = 'https://dblxlgaming-sudo.github.io/tennis-player-profile/', timeoutMs, git = new RealGit(repoRoot), verifier = verifyLivePublication, lockOptions, now = new Date() }) {
  let validation;
  try { validation = sport === 'tennis' ? validateTennis(candidates) : validateWnba(candidates); }
  catch (error) { throw new PublicationError('VALIDATION_FAILURE', error.message); }
  if (sport === 'wnba') validation.profilePath = candidates.profilePath;
  const releaseId = sport === 'tennis' ? tennisReleaseId(validation) : wnbaReleaseId(validation);
  const allowed = expectedPublicationPaths(sport, releaseId, validation);
  const releaseLock = acquirePublicationLock(repoRoot, lockOptions);
  try {
    git.assertCanonical();
    assertAllowlisted(git.statusPaths(), allowed);
    git.fetch();
    const relation = git.relation();
    if (relation === 'behind' || relation === 'diverged') throw new PublicationError('GIT_SAFETY_FAILURE', `origin/main is ${relation}; retry from a safely synchronized checkout`);
    const productManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data', 'publication-manifest.json'), 'utf8'));
    const other = sport === 'tennis' ? 'wnba' : 'tennis';
    const unaffectedRelease = productManifest.sports[other].release;
    if (relation === 'ahead') {
      assertAllowlisted(git.aheadPaths(), allowed, 'unpushed commit');
      if (productManifest.sports[sport].release !== releaseId) throw new PublicationError('GIT_SAFETY_FAILURE', 'Local branch is ahead but does not contain the intended release pointer');
      try { git.push(); } catch (error) { throw error instanceof PublicationError ? error : new PublicationError('PUSH_FAILURE', error.message); }
      const live = await verifier({ liveUrl, sport, releaseId, validation, unaffectedRelease, timeoutMs });
      return { state: 'SUCCESS', releaseId, commit: git.head(), pushed: true, recovered: true, live };
    }
    const dirtyBefore = git.statusPaths();
    if (productManifest.sports[sport].release !== releaseId) {
      try {
        if (sport === 'tennis') promoteTennis({ repoRoot, ...candidates, now }); else promoteWnba({ repoRoot, ...candidates, now });
      } catch (error) { throw new PublicationError('LOCAL_PROMOTION_FAILURE', error.message); }
    }
    assertAllowlisted(git.statusPaths(), allowed);
    if (!git.statusPaths().length && !dirtyBefore.length) {
      const live = await verifier({ liveUrl, sport, releaseId, validation, unaffectedRelease, timeoutMs });
      return { state: 'SUCCESS', releaseId, commit: git.head(), pushed: false, idempotent: true, live };
    }
    git.stage(allowed);
    assertAllowlisted(git.stagedPaths(), allowed, 'staged publication');
    if (!git.hasStagedChanges()) {
      const live = await verifier({ liveUrl, sport, releaseId, validation, unaffectedRelease, timeoutMs });
      return { state: 'SUCCESS', releaseId, commit: git.head(), pushed: false, idempotent: true, live };
    }
    const label = sport === 'tennis' ? 'Tennis' : 'WNBA';
    const commit = git.commit(`Publish ${label} Player Profile data ${releaseId}`);
    try { git.push(); } catch (error) {
      const failure = error instanceof PublicationError ? error : new PublicationError('PUSH_FAILURE', error.message);
      failure.localNewerThanLive = true; failure.commit = commit; throw failure;
    }
    const live = await verifier({ liveUrl, sport, releaseId, validation, unaffectedRelease, timeoutMs });
    return { state: 'SUCCESS', releaseId, commit, pushed: true, live };
  } finally { releaseLock(); }
}

export async function productionRollback({ sport, releaseId, repoRoot, liveUrl = 'https://dblxlgaming-sudo.github.io/tennis-player-profile/', timeoutMs, git = new RealGit(repoRoot), verifier = verifyLivePublication, lockOptions, now = new Date() }) {
  const releaseDir = path.join(repoRoot, 'data', 'releases', sport, releaseId);
  let validation;
  if (sport === 'tennis') {
    const receiptPath = path.join(releaseDir, 'publication-receipt.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    validation = validateTennis({ manifestPath: receiptPath, profilePath: path.join(releaseDir, receipt.Artifacts.PlayerProfile.FileName), historyPath: path.join(releaseDir, receipt.Artifacts.PlayerStatCharts.FileName) });
  } else {
    const metadata = JSON.parse(fs.readFileSync(path.join(releaseDir, 'release-metadata.json'), 'utf8'));
    validation = validateWnba({ profilePath: path.join(releaseDir, metadata.artifact.fileName) });
  }
  const allowed = ['data/publication-manifest.json'];
  const releaseLock = acquirePublicationLock(repoRoot, lockOptions);
  try {
    git.assertCanonical(); assertAllowlisted(git.statusPaths(), allowed); git.fetch();
    const relation = git.relation();
    if (relation !== 'equal') throw new PublicationError('GIT_SAFETY_FAILURE', `Rollback requires local HEAD equal to origin/main; found ${relation}`);
    const before = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data', 'publication-manifest.json'), 'utf8'));
    const other = sport === 'tennis' ? 'wnba' : 'tennis'; const unaffectedRelease = before.sports[other].release;
    if (before.sports[sport].release === releaseId && !git.statusPaths().length) {
      const live = await verifier({ liveUrl, sport, releaseId, validation, unaffectedRelease, timeoutMs });
      return { state: 'SUCCESS', releaseId, commit: git.head(), pushed: false, idempotent: true, live };
    }
    try { rollback({ repoRoot, sport, releaseId, now }); } catch (error) { throw new PublicationError('LOCAL_PROMOTION_FAILURE', error.message); }
    assertAllowlisted(git.statusPaths(), allowed); git.stage(allowed); assertAllowlisted(git.stagedPaths(), allowed, 'staged rollback');
    const commit = git.commit(`Rollback ${sport === 'tennis' ? 'Tennis' : 'WNBA'} Player Profile data to ${releaseId}`);
    try { git.push(); } catch (error) { const failure = error instanceof PublicationError ? error : new PublicationError('PUSH_FAILURE', error.message); failure.localNewerThanLive = true; failure.commit = commit; throw failure; }
    const live = await verifier({ liveUrl, sport, releaseId, validation, unaffectedRelease, timeoutMs });
    return { state: 'SUCCESS', releaseId, commit, pushed: true, rollback: true, live };
  } finally { releaseLock(); }
}
