import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TENNIS_MANIFEST_VERSION = 'tennis-player-profile-publication-v1';
export const WNBA_PROFILE_VERSION = 'wnba-player-profile-v1';
export const SURFACES = new Set(['All', 'Hard', 'Clay', 'Grass']);
export const TENNIS_PROFILE_FIELDS = ['Player', 'Surface'];
export const TENNIS_HISTORY_FIELDS = ['MatchID', 'Date', 'Player', 'Opponent', 'OpponentRank', 'Surface', 'FinalScore', 'Result', 'MatchStatus'];

export function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function parseCsvStrict(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      if (field !== '') throw new Error('Malformed CSV: quote inside an unquoted field');
      quoted = true;
    } else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (!rows.length) throw new Error('Malformed CSV: no header row');
  const headers = rows.shift();
  if (headers.length) headers[0] = headers[0].replace(/^\uFEFF/, '');
  if (headers.some((header) => !header)) throw new Error('Malformed CSV: blank header');
  if (new Set(headers).size !== headers.length) throw new Error('Malformed CSV: duplicate header');
  const dataRows = rows.filter((cells) => cells.some((cell) => cell !== ''));
  dataRows.forEach((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`Malformed CSV: row ${index + 2} has ${cells.length} fields; expected ${headers.length}`);
  });
  return { headers, rows: dataRows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]]))) };
}

function requireFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`${label} file does not exist: ${filePath || '(missing)'}`);
}

function requireFields(headers, fields, label) {
  for (const field of fields) if (!headers.includes(field)) throw new Error(`${label} is missing required field: ${field}`);
}

function readJsonStrict(filePath, label) {
  requireFile(filePath, label);
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
}

export function validateTennis({ manifestPath, profilePath, historyPath }) {
  requireFile(profilePath, 'Tennis Player Profile');
  requireFile(historyPath, 'Tennis factual history');
  const manifest = readJsonStrict(manifestPath, 'Tennis publication manifest');
  if (manifest.ManifestVersion !== TENNIS_MANIFEST_VERSION) throw new Error(`Unsupported Tennis ManifestVersion: ${manifest.ManifestVersion || '(missing)'}`);
  if (manifest.Sport !== 'Tennis') throw new Error(`Tennis manifest Sport must be Tennis; received ${manifest.Sport || '(missing)'}`);
  if (!/^tennis-v2-snapshot-sha256:[a-f0-9]{64}$/.test(manifest.SnapshotID || '')) throw new Error('Tennis manifest SnapshotID is missing or invalid');
  const snapshotHash = manifest.SnapshotID.slice('tennis-v2-snapshot-sha256:'.length);
  if (manifest.SourceSnapshot?.SHA256 !== snapshotHash) throw new Error('SourceSnapshot SHA256 does not match SnapshotID');
  const profileReceipt = manifest.Artifacts?.PlayerProfile;
  const historyReceipt = manifest.Artifacts?.PlayerStatCharts;
  if (!profileReceipt || !historyReceipt) throw new Error('Tennis manifest must include both required artifact entries');
  if (path.basename(profilePath) !== profileReceipt.FileName) throw new Error('Player Profile filename does not match manifest');
  if (path.basename(historyPath) !== historyReceipt.FileName) throw new Error('Player Stat Charts filename does not match manifest');
  const profileHash = sha256(profilePath); const historyHash = sha256(historyPath);
  if (profileHash !== String(profileReceipt.SHA256 || '').toLowerCase()) throw new Error('Player Profile SHA-256 does not match manifest');
  if (historyHash !== String(historyReceipt.SHA256 || '').toLowerCase()) throw new Error('Player Stat Charts SHA-256 does not match manifest');
  const profileCsv = parseCsvStrict(fs.readFileSync(profilePath, 'utf8'));
  const historyCsv = parseCsvStrict(fs.readFileSync(historyPath, 'utf8'));
  requireFields(profileCsv.headers, TENNIS_PROFILE_FIELDS, 'Tennis Player Profile');
  requireFields(historyCsv.headers, TENNIS_HISTORY_FIELDS, 'Tennis factual history');
  if (profileCsv.rows.length !== profileReceipt.Rows) throw new Error(`Player Profile row count ${profileCsv.rows.length} does not match manifest ${profileReceipt.Rows}`);
  if (historyCsv.rows.length !== historyReceipt.Rows) throw new Error(`Player Stat Charts row count ${historyCsv.rows.length} does not match manifest ${historyReceipt.Rows}`);
  const identities = new Set();
  for (const [index, row] of profileCsv.rows.entries()) {
    if (!row.Player) throw new Error(`Player Profile row ${index + 2} has blank Player`);
    if (!SURFACES.has(row.Surface)) throw new Error(`Player Profile row ${index + 2} has unrecognized Surface: ${row.Surface || '(blank)'}`);
    const identity = `${row.Player}\u0000${row.Surface}`;
    if (identities.has(identity)) throw new Error(`Duplicate Player + Surface: ${row.Player} / ${row.Surface}`);
    identities.add(identity);
  }
  for (const [index, row] of historyCsv.rows.entries()) {
    if (!row.MatchID) throw new Error(`Player Stat Charts row ${index + 2} has blank MatchID`);
    if (!row.Player) throw new Error(`Player Stat Charts row ${index + 2} has blank Player`);
    if (!row.Opponent) throw new Error(`Player Stat Charts row ${index + 2} has blank Opponent`);
  }
  return { sport: 'tennis', manifest, profileHash, historyHash, profileRows: profileCsv.rows.length, historyRows: historyCsv.rows.length };
}

function findForbiddenKey(value, trail = []) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (/projection|sportsbook|market|odds|\blbg\b|betting|probabilit|hit.?rate|modeloutput|modelprediction/i.test(key)) return [...trail, key].join('.');
    const nested = findForbiddenKey(child, [...trail, key]); if (nested) return nested;
  }
  return null;
}

export function validateWnba({ profilePath }) {
  const artifact = readJsonStrict(profilePath, 'WNBA profile');
  if (artifact.ProfileVersion !== WNBA_PROFILE_VERSION) throw new Error(`Unsupported WNBA ProfileVersion: ${artifact.ProfileVersion || '(missing)'}`);
  if (!Array.isArray(artifact.Profiles)) throw new Error('WNBA Profiles collection is missing');
  const coverage = artifact.CoverageManifest;
  if (!coverage || !coverage.TrackedDateStart || !coverage.TrackedDateEnd) throw new Error('WNBA coverage metadata or tracked date range is missing');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(coverage.TrackedDateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(coverage.TrackedDateEnd) || coverage.TrackedDateStart > coverage.TrackedDateEnd) throw new Error('WNBA tracked date range is invalid');
  const ids = new Set();
  let playersWithGames = 0; let playedGameRows = 0;
  for (const [index, profile] of artifact.Profiles.entries()) {
    if (!profile.PlayerID) throw new Error(`WNBA profile ${index + 1} is missing PlayerID`);
    if (ids.has(profile.PlayerID)) throw new Error(`Duplicate WNBA PlayerID: ${profile.PlayerID}`);
    ids.add(profile.PlayerID);
    if (profile.ProfileVersion !== WNBA_PROFILE_VERSION) throw new Error(`WNBA ${profile.PlayerID} has invalid ProfileVersion`);
    if (!Number.isInteger(profile.GamesPlayed) || profile.GamesPlayed < 0) throw new Error(`WNBA ${profile.PlayerID} has invalid GamesPlayed`);
    if (profile.GamesPlayed > 0) playersWithGames += 1;
    playedGameRows += profile.GamesPlayed;
    if (!profile.Overall || profile.Overall.GamesPlayed !== profile.GamesPlayed) throw new Error(`WNBA ${profile.PlayerID} has inconsistent Overall GamesPlayed`);
    if (!Array.isArray(profile.RecentGames)) throw new Error(`WNBA ${profile.PlayerID} is missing RecentGames`);
    if (profile.GamesPlayed === 0 && profile.RecentGames.length) throw new Error(`WNBA ${profile.PlayerID} has zero GamesPlayed but nonempty RecentGames`);
  }
  if (coverage.Profiles !== undefined && coverage.Profiles !== artifact.Profiles.length) throw new Error('WNBA CoverageManifest Profiles count is inconsistent');
  if (coverage.PlayersWithPlayedGames !== undefined && coverage.PlayersWithPlayedGames !== playersWithGames) throw new Error('WNBA CoverageManifest PlayersWithPlayedGames is inconsistent');
  if (coverage.PlayedGameRows !== undefined && coverage.PlayedGameRows !== playedGameRows) throw new Error('WNBA CoverageManifest PlayedGameRows is inconsistent');
  const forbidden = findForbiddenKey(artifact);
  if (forbidden) throw new Error(`WNBA artifact contains prohibited field: ${forbidden}`);
  return { sport: 'wnba', artifact, hash: sha256(profilePath), profiles: artifact.Profiles.length, coverage };
}

function readProductManifest(repoRoot) {
  const manifestPath = path.join(repoRoot, 'data', 'publication-manifest.json');
  return { manifestPath, manifest: readJsonStrict(manifestPath, 'Player Profile publication manifest') };
}

function releasePath(repoRoot, sport, releaseId) { return path.join(repoRoot, 'data', 'releases', sport, releaseId); }
function webPath(...parts) { return `./${parts.join('/').replaceAll('\\', '/')}`; }
function safeReleaseId(value) { return value.replace(/[^a-zA-Z0-9._-]/g, '-'); }

export function tennisReleaseId(validated) {
  const snapshotHash = validated.manifest.SnapshotID.split(':').at(-1);
  return safeReleaseId(`${validated.manifest.DataThrough || 'undated'}-${snapshotHash.slice(0, 16)}`);
}

export function wnbaReleaseId(validated) {
  return safeReleaseId(`${validated.coverage.TrackedDateEnd}-${validated.hash.slice(0, 16)}`);
}

function stageRelease(repoRoot, sport, releaseId, files) {
  const sportRoot = path.join(repoRoot, 'data', 'releases', sport);
  fs.mkdirSync(sportRoot, { recursive: true });
  const finalDir = releasePath(repoRoot, sport, releaseId);
  if (fs.existsSync(finalDir)) return finalDir;
  const stageDir = path.join(sportRoot, `.staging-${releaseId}-${crypto.randomUUID()}`);
  fs.mkdirSync(stageDir, { recursive: false });
  try {
    for (const file of files) fs.copyFileSync(file.from, path.join(stageDir, file.name), fs.constants.COPYFILE_EXCL);
    fs.renameSync(stageDir, finalDir);
  } catch (error) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw error;
  }
  return finalDir;
}

function writeManifestAtomically(manifestPath, manifest) {
  const temp = `${manifestPath}.tmp-${crypto.randomUUID()}`;
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temp, manifestPath);
}

export function promoteTennis({ repoRoot, manifestPath, profilePath, historyPath, now = new Date() }) {
  const validated = validateTennis({ manifestPath, profilePath, historyPath });
  const releaseId = tennisReleaseId(validated);
  const sourceManifestName = 'publication-receipt.json';
  const finalDir = stageRelease(repoRoot, 'tennis', releaseId, [
    { from: profilePath, name: validated.manifest.Artifacts.PlayerProfile.FileName },
    { from: historyPath, name: validated.manifest.Artifacts.PlayerStatCharts.FileName },
    { from: manifestPath, name: sourceManifestName }
  ]);
  const staged = validateTennis({ manifestPath: path.join(finalDir, sourceManifestName), profilePath: path.join(finalDir, validated.manifest.Artifacts.PlayerProfile.FileName), historyPath: path.join(finalDir, validated.manifest.Artifacts.PlayerStatCharts.FileName) });
  const { manifestPath: productManifestPath, manifest: productManifest } = readProductManifest(repoRoot);
  const previous = productManifest.sports.tennis;
  productManifest.sports.tennis = {
    release: releaseId, snapshotId: staged.manifest.SnapshotID, publishedAt: now.toISOString(), dataThrough: staged.manifest.DataThrough,
    contract: webPath('docs', 'PLAYER_PROFILE_CONTRACT.md'), publicationContract: webPath('docs', 'PLAYER_PROFILE_PUBLICATION_MANIFEST_CONTRACT.md'),
    receipt: webPath('data', 'releases', 'tennis', releaseId, sourceManifestName),
    profile: webPath('data', 'releases', 'tennis', releaseId, staged.manifest.Artifacts.PlayerProfile.FileName),
    history: webPath('data', 'releases', 'tennis', releaseId, staged.manifest.Artifacts.PlayerStatCharts.FileName),
    artifacts: { playerProfile: { sha256: staged.profileHash, rows: staged.profileRows }, playerStatCharts: { sha256: staged.historyHash, rows: staged.historyRows } },
    previousRelease: previous?.release || null
  };
  writeManifestAtomically(productManifestPath, productManifest);
  return { releaseId, validation: staged };
}

export function promoteWnba({ repoRoot, profilePath, now = new Date() }) {
  const validated = validateWnba({ profilePath });
  const releaseId = wnbaReleaseId(validated);
  const artifactName = path.basename(profilePath);
  const metadataName = 'release-metadata.json';
  const metadataTemp = path.join(repoRoot, 'data', `.wnba-metadata-${crypto.randomUUID()}.json`);
  const metadata = { sport: 'wnba', release: releaseId, profileVersion: validated.artifact.ProfileVersion, generatedAt: validated.artifact.GeneratedAt, publishedAt: now.toISOString(), trackedDateStart: validated.coverage.TrackedDateStart, trackedDateEnd: validated.coverage.TrackedDateEnd, artifact: { fileName: artifactName, sha256: validated.hash, profiles: validated.profiles } };
  fs.writeFileSync(metadataTemp, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
  let finalDir;
  try { finalDir = stageRelease(repoRoot, 'wnba', releaseId, [{ from: profilePath, name: artifactName }, { from: metadataTemp, name: metadataName }]); }
  finally { fs.rmSync(metadataTemp, { force: true }); }
  const staged = validateWnba({ profilePath: path.join(finalDir, artifactName) });
  if (staged.hash !== metadata.artifact.sha256) throw new Error('Staged WNBA hash does not match release metadata');
  const { manifestPath: productManifestPath, manifest: productManifest } = readProductManifest(repoRoot);
  const previous = productManifest.sports.wnba;
  productManifest.sports.wnba = {
    release: releaseId, publishedAt: now.toISOString(), profileVersion: staged.artifact.ProfileVersion,
    trackedDateStart: staged.coverage.TrackedDateStart, trackedDateEnd: staged.coverage.TrackedDateEnd,
    contract: webPath('docs', 'wnba_player_profile_v1.md'), metadata: webPath('data', 'releases', 'wnba', releaseId, metadataName),
    profile: webPath('data', 'releases', 'wnba', releaseId, artifactName), artifact: { sha256: staged.hash, profiles: staged.profiles }, previousRelease: previous?.release || null
  };
  writeManifestAtomically(productManifestPath, productManifest);
  return { releaseId, validation: staged };
}

export function rollback({ repoRoot, sport, releaseId, now = new Date() }) {
  if (!['tennis', 'wnba'].includes(sport)) throw new Error('Rollback sport must be tennis or wnba');
  const dir = releasePath(repoRoot, sport, releaseId);
  if (!fs.existsSync(dir)) throw new Error(`Release does not exist: ${releaseId}`);
  const { manifestPath, manifest } = readProductManifest(repoRoot);
  const current = manifest.sports[sport];
  if (sport === 'tennis') {
    const receiptPath = path.join(dir, 'publication-receipt.json'); const receipt = readJsonStrict(receiptPath, 'Tennis release receipt');
    const validated = validateTennis({ manifestPath: receiptPath, profilePath: path.join(dir, receipt.Artifacts.PlayerProfile.FileName), historyPath: path.join(dir, receipt.Artifacts.PlayerStatCharts.FileName) });
    manifest.sports.tennis = { ...current, release: releaseId, snapshotId: receipt.SnapshotID, publishedAt: now.toISOString(), dataThrough: receipt.DataThrough, receipt: webPath('data','releases','tennis',releaseId,'publication-receipt.json'), profile: webPath('data','releases','tennis',releaseId,receipt.Artifacts.PlayerProfile.FileName), history: webPath('data','releases','tennis',releaseId,receipt.Artifacts.PlayerStatCharts.FileName), artifacts: { playerProfile: { sha256: validated.profileHash, rows: validated.profileRows }, playerStatCharts: { sha256: validated.historyHash, rows: validated.historyRows } }, previousRelease: current.release };
  } else {
    const metadata = readJsonStrict(path.join(dir, 'release-metadata.json'), 'WNBA release metadata');
    const validated = validateWnba({ profilePath: path.join(dir, metadata.artifact.fileName) });
    if (validated.hash !== metadata.artifact.sha256) throw new Error('WNBA rollback release hash does not match metadata');
    manifest.sports.wnba = { ...current, release: releaseId, publishedAt: now.toISOString(), profileVersion: validated.artifact.ProfileVersion, trackedDateStart: validated.coverage.TrackedDateStart, trackedDateEnd: validated.coverage.TrackedDateEnd, metadata: webPath('data','releases','wnba',releaseId,'release-metadata.json'), profile: webPath('data','releases','wnba',releaseId,metadata.artifact.fileName), artifact: { sha256: validated.hash, profiles: validated.profiles }, previousRelease: current.release };
  }
  writeManifestAtomically(manifestPath, manifest);
  return { sport, releaseId };
}
