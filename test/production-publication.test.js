import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquirePublicationLock, expectedPublicationPaths, productionPublish, productionRollback, PublicationError } from '../scripts/production-publication.mjs';
import { promoteTennis } from '../scripts/publication-lib.mjs';

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-publisher-'));
  fs.mkdirSync(path.join(root, '.git')); fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'publication-manifest.json'), JSON.stringify({ interfaceVersion: 'triple-threat-player-profile-publication-v1', sports: { tennis: { release: 'old-tennis' }, wnba: { release: 'old-wnba' } } }));
  return root;
}
function tennis(root, snapshot = 'a') {
  const profilePath = path.join(root, 'TripleThreat_Tennis_V2_Player_Profile.csv'); const historyPath = path.join(root, 'TripleThreat_Tennis_V2_Player_Stat_Charts.csv'); const manifestPath = path.join(root, 'receipt.json');
  fs.writeFileSync(profilePath, 'Player,Surface\nAlpha,All\nAlpha,Hard\n');
  fs.writeFileSync(historyPath, 'MatchID,Date,Player,Opponent,OpponentRank,Surface,FinalScore,Result,MatchStatus\nm1,2026-01-01,Alpha,Beta,,Hard,6-4,W,Completed\n');
  const snapshotHash = snapshot.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify({ ManifestVersion: 'tennis-player-profile-publication-v1', Sport: 'Tennis', SnapshotID: `tennis-v2-snapshot-sha256:${snapshotHash}`, DataThrough: '2026-01-01', SourceSnapshot: { SHA256: snapshotHash }, Artifacts: { PlayerProfile: { FileName: path.basename(profilePath), SHA256: hash(profilePath), Rows: 2 }, PlayerStatCharts: { FileName: path.basename(historyPath), SHA256: hash(historyPath), Rows: 1 } } }));
  return { manifestPath, profilePath, historyPath };
}
function wnba(root) {
  const profilePath = path.join(root, 'wnba_player_profiles_v1.json');
  fs.writeFileSync(profilePath, JSON.stringify({ ProfileVersion: 'wnba-player-profile-v1', CoverageManifest: { TrackedDateStart: '2026-01-01', TrackedDateEnd: '2026-01-02', Profiles: 1, PlayersWithPlayedGames: 0, PlayedGameRows: 0 }, Profiles: [{ ProfileVersion: 'wnba-player-profile-v1', PlayerID: 'espn:1', GamesPlayed: 0, Overall: { GamesPlayed: 0 }, RecentGames: [] }] }));
  return { profilePath };
}
class FakeGit {
  constructor(root, sport, releaseId, options = {}) { Object.assign(this, { root, sport, releaseId, options, commits: 0, pushes: 0, headValue: 'head-0', staged: [] }); }
  assertCanonical() { if (this.options.canonicalError) throw new PublicationError('GIT_SAFETY_FAILURE', this.options.canonicalError); }
  currentRelease() { return JSON.parse(fs.readFileSync(path.join(this.root, 'data', 'publication-manifest.json'))).sports[this.sport].release; }
  statusPaths() {
    if (this.options.dirty) return this.options.dirty;
    if (this.currentRelease() !== (this.options.initialRelease || `old-${this.sport}`)) return this.options.expected;
    return [];
  }
  fetch() { this.fetched = true; }
  relation() { return this.options.relation || 'equal'; }
  aheadPaths() { return this.options.aheadPaths || this.options.expected; }
  stage(paths) { this.staged = paths; }
  stagedPaths() { return this.staged; }
  hasStagedChanges() { return this.options.noStaged ? false : this.staged.length > 0; }
  commit(message) { this.commits += 1; this.message = message; this.headValue = 'head-1'; return this.headValue; }
  push() { this.pushes += 1; if (this.options.pushFails) throw new PublicationError('PUSH_FAILURE', 'simulated push failure'); }
  head() { return this.headValue; }
}
const verifier = async (args) => ({ verified: true, release: args.releaseId, unaffected: args.unaffectedRelease });
function setup(sport) {
  const root = repo(); const candidates = sport === 'tennis' ? tennis(root) : wnba(root);
  const validation = sport === 'tennis'
    ? { manifest: JSON.parse(fs.readFileSync(candidates.manifestPath)), profileHash: hash(candidates.profilePath), historyHash: hash(candidates.historyPath) }
    : { hash: hash(candidates.profilePath), coverage: { TrackedDateEnd: '2026-01-02' }, profilePath: candidates.profilePath };
  const releaseId = sport === 'tennis' ? `2026-01-01-${'a'.repeat(16)}` : `2026-01-02-${validation.hash.slice(0, 16)}`;
  const expected = expectedPublicationPaths(sport, releaseId, validation); const git = new FakeGit(root, sport, releaseId, { expected });
  return { root, candidates, releaseId, expected, git };
}

test('successful Tennis production transaction commits and pushes only Tennis', async () => {
  const s = setup('tennis'); const result = await productionPublish({ sport: 'tennis', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier });
  assert.equal(result.state, 'SUCCESS'); assert.equal(s.git.commits, 1); assert.equal(s.git.pushes, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(s.root, 'data/publication-manifest.json'))).sports.wnba.release, 'old-wnba');
});
test('successful WNBA production transaction commits and pushes only WNBA', async () => {
  const s = setup('wnba'); const result = await productionPublish({ sport: 'wnba', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier });
  assert.equal(result.state, 'SUCCESS'); assert.equal(s.git.commits, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(s.root, 'data/publication-manifest.json'))).sports.tennis.release, 'old-tennis');
});
test('validation failure creates no commit', async () => {
  const s = setup('tennis'); fs.writeFileSync(s.candidates.profilePath, 'bad'); await assert.rejects(() => productionPublish({ sport: 'tennis', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier }), (error) => error.code === 'VALIDATION_FAILURE'); assert.equal(s.git.commits, 0);
});
test('unrelated dirty file blocks production', async () => {
  const s = setup('tennis'); s.git.options.dirty = ['app.js']; await assert.rejects(() => productionPublish({ sport: 'tennis', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier }), /Unexpected working tree paths/); assert.equal(s.git.commits, 0);
});
test('publication paths are exact allowlisted files', () => {
  const s = setup('tennis'); assert.deepEqual(s.expected, ['data/publication-manifest.json', `data/releases/tennis/${s.releaseId}/TripleThreat_Tennis_V2_Player_Profile.csv`, `data/releases/tennis/${s.releaseId}/TripleThreat_Tennis_V2_Player_Stat_Charts.csv`, `data/releases/tennis/${s.releaseId}/publication-receipt.json`]);
});
test('wrong branch and wrong remote block publication through canonical check', async () => {
  for (const message of ['Production publication requires branch main', 'Unexpected origin remote']) { const s = setup('wnba'); s.git.options.canonicalError = message; await assert.rejects(() => productionPublish({ sport: 'wnba', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier }), new RegExp(message)); }
});
test('no force-push command or path exists', () => {
  const source = fs.readFileSync(new URL('../scripts/production-publication.mjs', import.meta.url), 'utf8'); assert.doesNotMatch(source, /force-with-lease|push[^\n]*--force|push[^\n]*-f\b/); assert.match(source, /\['push', 'origin', 'main'\]/);
});
test('same release is idempotent with no commit or push', async () => {
  const s = setup('tennis'); promoteTennis({ repoRoot: s.root, ...s.candidates }); s.git.options.initialRelease = s.releaseId; const result = await productionPublish({ sport: 'tennis', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier }); assert.equal(result.idempotent, true); assert.equal(s.git.commits, 0); assert.equal(s.git.pushes, 0);
});
test('concurrent publication lock is retryable and cannot overlap', () => {
  const root = repo(); const unlock = acquirePublicationLock(root, { waitMs: 0 }); assert.throws(() => acquirePublicationLock(root, { waitMs: 0 }), /retryable/); unlock(); const unlockAgain = acquirePublicationLock(root, { waitMs: 0 }); unlockAgain();
});
test('stale remote state is not reconciled or pushed blindly', async () => {
  for (const relation of ['behind', 'diverged']) { const s = setup('tennis'); s.git.options.relation = relation; await assert.rejects(() => productionPublish({ sport: 'tennis', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier }), new RegExp(relation)); assert.equal(s.git.pushes, 0); }
});
test('push failure is surfaced and local-newer-than-live is recoverable', async () => {
  const s = setup('wnba'); s.git.options.pushFails = true; await assert.rejects(() => productionPublish({ sport: 'wnba', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier }), (error) => error.code === 'PUSH_FAILURE' && error.localNewerThanLive === true);
  s.git.options.pushFails = false; s.git.options.relation = 'ahead'; s.git.options.aheadPaths = s.expected; const retry = await productionPublish({ sport: 'wnba', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier }); assert.equal(retry.recovered, true);
});
test('live verifier receives intended and unaffected release pointers', async () => {
  const s = setup('tennis'); let received; await productionPublish({ sport: 'tennis', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier: async (args) => { received = args; return {}; } }); assert.equal(received.releaseId, s.releaseId); assert.equal(received.unaffectedRelease, 'old-wnba');
});
test('live hash mismatch is surfaced', async () => {
  const s = setup('wnba'); await assert.rejects(() => productionPublish({ sport: 'wnba', candidates: s.candidates, repoRoot: s.root, git: s.git, verifier: async () => { throw new PublicationError('LIVE_HASH_VERIFICATION_FAILURE', 'mismatch'); } }), (error) => error.code === 'LIVE_HASH_VERIFICATION_FAILURE');
});
test('production rollback commits, pushes, and preserves other sport', async () => {
  const s = setup('tennis'); const first = promoteTennis({ repoRoot: s.root, ...s.candidates }); const secondCandidate = tennis(s.root, 'b'); promoteTennis({ repoRoot: s.root, ...secondCandidate });
  const git = new FakeGit(s.root, 'tennis', first.releaseId, { expected: ['data/publication-manifest.json'], initialRelease: `2026-01-01-${'b'.repeat(16)}` });
  const result = await productionRollback({ sport: 'tennis', releaseId: first.releaseId, repoRoot: s.root, git, verifier }); assert.equal(result.rollback, true); assert.equal(git.commits, 1); assert.equal(git.pushes, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(s.root, 'data/publication-manifest.json'))).sports.wnba.release, 'old-wnba');
});
test('.gitattributes preserves versioned release bytes', () => {
  const attributes = fs.readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8'); assert.match(attributes, /data\/releases\/\*\* -text/);
});
