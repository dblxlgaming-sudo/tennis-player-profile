import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promoteTennis, promoteWnba, rollback, validateTennis, validateWnba } from '../scripts/publication-lib.mjs';

const PROFILE_HEADER = 'Player,Surface,RawMatchCount';
const HISTORY_HEADER = 'MatchID,Date,Player,Opponent,Surface,OpponentRank,MatchStatus,FinalScore,Result';
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-publisher-'));
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'publication-manifest.json'), JSON.stringify({ interfaceVersion: 'triple-threat-player-profile-publication-v1', sports: { tennis: { release: 'old-tennis', profile: './old-profile.csv', history: './old-history.csv' }, wnba: { release: 'old-wnba', profile: './old-wnba.json' } } }, null, 2));
  return root;
}

function tennisCandidate(root, options = {}) {
  const profile = path.join(root, 'TripleThreat_Tennis_V2_Player_Profile.csv');
  const history = path.join(root, 'TripleThreat_Tennis_V2_Player_Stat_Charts.csv');
  const manifest = path.join(root, 'TripleThreat_Tennis_V2_Player_Profile_Publication_Manifest.json');
  fs.writeFileSync(profile, options.profileText ?? `${PROFILE_HEADER}\nAlpha,All,2\nAlpha,Hard,1\n`);
  fs.writeFileSync(history, options.historyText ?? `${HISTORY_HEADER}\nm1,2026-01-01,Alpha,Beta,Hard,,Completed,6-4 6-4,W\n`);
  const snapshot = 'a'.repeat(64);
  const receipt = {
    ManifestVersion: options.version ?? 'tennis-player-profile-publication-v1', Sport: 'Tennis', SnapshotID: `tennis-v2-snapshot-sha256:${snapshot}`,
    GeneratedAt: '2026-01-02T00:00:00Z', DataThrough: '2026-01-01', SourceSnapshot: { SHA256: snapshot },
    Contracts: { PlayerProfile: 'player-profile-v1', PlayerStatCharts: 'player-stat-charts-historical-v1' },
    Artifacts: { PlayerProfile: { FileName: path.basename(profile), SHA256: hash(profile), Rows: (options.profileText ?? 'x\nx\nx').trim().split('\n').length - 1 }, PlayerStatCharts: { FileName: path.basename(history), SHA256: hash(history), Rows: (options.historyText ?? 'x\nx').trim().split('\n').length - 1 } }
  };
  if (options.mutateReceipt) options.mutateReceipt(receipt);
  fs.writeFileSync(manifest, JSON.stringify(receipt));
  return { manifestPath: manifest, profilePath: profile, historyPath: history };
}

function wnbaCandidate(root, options = {}) {
  const profile = path.join(root, 'wnba_player_profiles_v1.json');
  const artifact = {
    ProfileVersion: options.version ?? 'wnba-player-profile-v1', GeneratedAt: '2026-01-03T00:00:00Z',
    CoverageManifest: { TrackedDateStart: '2026-01-01', TrackedDateEnd: '2026-01-02' },
    Profiles: options.profiles ?? [{ ProfileVersion: 'wnba-player-profile-v1', PlayerID: 'espn:1', PlayerName: 'One', GamesPlayed: 0, Overall: { GamesPlayed: 0 }, RecentGames: [], Optional: null }]
  };
  fs.writeFileSync(profile, options.raw ?? JSON.stringify(artifact));
  return { profilePath: profile };
}

function pointer(root, sport) { return JSON.parse(fs.readFileSync(path.join(root, 'data', 'publication-manifest.json'))).sports[sport]; }

test('valid Tennis manifest and atomic pair pass', () => {
  const root = workspace(); const result = validateTennis(tennisCandidate(root));
  assert.equal(result.profileRows, 2); assert.equal(result.historyRows, 1);
});
test('UTF-8 BOM is accepted without changing hashed artifact bytes', () => {
  const root = workspace(); const candidate = tennisCandidate(root, { profileText: `\uFEFF${PROFILE_HEADER}\nAlpha,All,2\n` });
  const result = validateTennis(candidate); assert.equal(result.profileRows, 1); assert.equal(result.profileHash, hash(candidate.profilePath));
});
test('Tennis manifest hash mismatch fails', () => {
  const root = workspace(); const candidate = tennisCandidate(root, { mutateReceipt: (receipt) => { receipt.Artifacts.PlayerProfile.SHA256 = '0'.repeat(64); } });
  assert.throws(() => validateTennis(candidate), /SHA-256/);
});
test('missing Tennis profile fails', () => {
  const root = workspace(); const candidate = tennisCandidate(root); fs.rmSync(candidate.profilePath);
  assert.throws(() => validateTennis(candidate), /does not exist/);
});
test('missing Tennis history fails', () => {
  const root = workspace(); const candidate = tennisCandidate(root); fs.rmSync(candidate.historyPath);
  assert.throws(() => validateTennis(candidate), /does not exist/);
});
test('malformed Tennis CSV fails', () => {
  const root = workspace(); const candidate = tennisCandidate(root, { profileText: `${PROFILE_HEADER}\n"Alpha,All,2\n` });
  assert.throws(() => validateTennis(candidate), /Malformed CSV/);
});
test('duplicate Tennis Player + Surface fails', () => {
  const root = workspace(); const candidate = tennisCandidate(root, { profileText: `${PROFILE_HEADER}\nAlpha,All,2\nAlpha,All,2\n` });
  assert.throws(() => validateTennis(candidate), /Duplicate Player/);
});
test('missing required Tennis field fails', () => {
  const root = workspace(); const candidate = tennisCandidate(root, { historyText: 'MatchID,Date,Player,Opponent,Surface,OpponentRank,FinalScore,Result\nm1,2026-01-01,A,B,Hard,,6-4,W\n' });
  assert.throws(() => validateTennis(candidate), /MatchStatus/);
});
test('failed Tennis validation leaves pointer unchanged', () => {
  const root = workspace(); const candidate = tennisCandidate(root, { mutateReceipt: (receipt) => { receipt.Artifacts.PlayerStatCharts.SHA256 = '0'.repeat(64); } });
  assert.throws(() => promoteTennis({ repoRoot: root, ...candidate }), /SHA-256/); assert.equal(pointer(root, 'tennis').release, 'old-tennis');
});
test('successful Tennis promotion changes Tennis only', () => {
  const root = workspace(); const beforeWnba = pointer(root, 'wnba'); const result = promoteTennis({ repoRoot: root, ...tennisCandidate(root), now: new Date('2026-01-04T00:00:00Z') });
  assert.equal(pointer(root, 'tennis').release, result.releaseId); assert.deepEqual(pointer(root, 'wnba'), beforeWnba);
});
test('valid WNBA artifact passes with nulls', () => {
  const root = workspace(); const result = validateWnba(wnbaCandidate(root)); assert.equal(result.profiles, 1);
});
test('malformed WNBA JSON fails', () => {
  const root = workspace(); assert.throws(() => validateWnba(wnbaCandidate(root, { raw: '{bad' })), /valid JSON/);
});
test('duplicate WNBA PlayerID fails', () => {
  const root = workspace(); const profile = { ProfileVersion: 'wnba-player-profile-v1', PlayerID: 'espn:1', GamesPlayed: 0, Overall: { GamesPlayed: 0 }, RecentGames: [] };
  assert.throws(() => validateWnba(wnbaCandidate(root, { profiles: [profile, profile] })), /Duplicate WNBA PlayerID/);
});
test('missing WNBA PlayerID fails', () => {
  const root = workspace(); assert.throws(() => validateWnba(wnbaCandidate(root, { profiles: [{ ProfileVersion: 'wnba-player-profile-v1', GamesPlayed: 0, Overall: { GamesPlayed: 0 }, RecentGames: [] }] })), /missing PlayerID/);
});
test('invalid WNBA contract version fails', () => {
  const root = workspace(); assert.throws(() => validateWnba(wnbaCandidate(root, { version: 'bad-version' })), /Unsupported WNBA ProfileVersion/);
});
test('unexpected WNBA market or model fields fail', () => {
  const root = workspace(); const candidate = wnbaCandidate(root); const artifact = JSON.parse(fs.readFileSync(candidate.profilePath)); artifact.MarketProjection = 1; fs.writeFileSync(candidate.profilePath, JSON.stringify(artifact));
  assert.throws(() => validateWnba(candidate), /prohibited field/);
});
test('failed WNBA validation leaves pointer unchanged', () => {
  const root = workspace(); const candidate = wnbaCandidate(root, { version: 'bad' }); assert.throws(() => promoteWnba({ repoRoot: root, ...candidate }), /Unsupported/); assert.equal(pointer(root, 'wnba').release, 'old-wnba');
});
test('successful WNBA promotion changes WNBA only', () => {
  const root = workspace(); const beforeTennis = pointer(root, 'tennis'); const result = promoteWnba({ repoRoot: root, ...wnbaCandidate(root), now: new Date('2026-01-04T00:00:00Z') });
  assert.equal(pointer(root, 'wnba').release, result.releaseId); assert.deepEqual(pointer(root, 'tennis'), beforeTennis);
});
test('cross-sport failures do not block the other sport', () => {
  const root = workspace(); const badTennis = tennisCandidate(root, { mutateReceipt: (receipt) => { receipt.Artifacts.PlayerProfile.SHA256 = '0'.repeat(64); } });
  assert.throws(() => promoteTennis({ repoRoot: root, ...badTennis })); const wnba = promoteWnba({ repoRoot: root, ...wnbaCandidate(root) }); assert.equal(pointer(root, 'wnba').release, wnba.releaseId); assert.equal(pointer(root, 'tennis').release, 'old-tennis');
  const root2 = workspace(); assert.throws(() => promoteWnba({ repoRoot: root2, ...wnbaCandidate(root2, { version: 'bad' }) })); const tennis = promoteTennis({ repoRoot: root2, ...tennisCandidate(root2) }); assert.equal(pointer(root2, 'tennis').release, tennis.releaseId); assert.equal(pointer(root2, 'wnba').release, 'old-wnba');
});
test('manifest changes only after staged validation and rollback restores pointer', () => {
  const root = workspace(); const first = promoteTennis({ repoRoot: root, ...tennisCandidate(root), now: new Date('2026-01-04T00:00:00Z') });
  const secondCandidate = tennisCandidate(root, { profileText: `${PROFILE_HEADER}\nAlpha,All,3\nAlpha,Hard,2\nAlpha,Clay,1\n`, mutateReceipt: (receipt) => { receipt.SnapshotID = `tennis-v2-snapshot-sha256:${'b'.repeat(64)}`; receipt.SourceSnapshot.SHA256 = 'b'.repeat(64); receipt.DataThrough = '2026-01-02'; } });
  const second = promoteTennis({ repoRoot: root, ...secondCandidate, now: new Date('2026-01-05T00:00:00Z') });
  assert.equal(pointer(root, 'tennis').release, second.releaseId); rollback({ repoRoot: root, sport: 'tennis', releaseId: first.releaseId, now: new Date('2026-01-06T00:00:00Z') }); assert.equal(pointer(root, 'tennis').release, first.releaseId);
});
