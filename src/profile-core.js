export const TENNIS_SURFACES = ['All', 'Hard', 'Clay', 'Grass'];
export function isMissing(value) { return value === null || value === undefined || (typeof value === 'string' && value.trim() === ''); }
export function display(value, formatter = String) { return isMissing(value) ? '—' : formatter(value); }
export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false; else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter((cells) => cells.some((cell) => cell !== '')).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}
export function tennisKey(player, surface) { return `${player}\u0000${surface}`; }
export function buildTennisIndex(profileRows) {
  const profiles = new Map(); const players = new Set();
  profileRows.forEach((row) => { if (row.Player && TENNIS_SURFACES.includes(row.Surface)) { profiles.set(tennisKey(row.Player, row.Surface), row); players.add(row.Player); } });
  return { profiles, players: [...players].sort((a, b) => a.localeCompare(b)) };
}
export function getTennisProfile(index, player, surface) { return TENNIS_SURFACES.includes(surface) ? index.profiles.get(tennisKey(player, surface)) || null : null; }
export function recentTennisMatches(rows, player, surface, limit = 5) {
  return rows.map((row, sourceIndex) => ({ ...row, sourceIndex }))
    .filter((row) => row.Player === player && (surface === 'All' || row.Surface === surface))
    .sort((a, b) => String(b.Date || '').localeCompare(String(a.Date || '')) || b.sourceIndex - a.sourceIndex).slice(0, limit);
}
export function buildWnbaIndex(artifact) {
  const profiles = new Map();
  (artifact.Profiles || []).forEach((profile) => { if (profile.PlayerID) profiles.set(profile.PlayerID, profile); });
  return { profiles, players: [...profiles.values()].sort((a, b) => a.PlayerName.localeCompare(b.PlayerName)), coverage: artifact.CoverageManifest || null, version: artifact.ProfileVersion || null };
}
export function getWnbaProfile(index, playerId) { return index.profiles.get(playerId) || null; }
export function recentWnbaGames(profile, limit = 5) {
  return (profile.RecentGames || []).filter((game) => game && game.Date && game.DidNotPlay !== true && game.Status !== 'did_not_play').map((game, sourceIndex) => ({ ...game, sourceIndex }))
    .sort((a, b) => String(b.Date).localeCompare(String(a.Date)) || b.sourceIndex - a.sourceIndex).slice(0, limit);
}
export function readNavigation(search) {
  const params = new URLSearchParams(search); const sport = params.get('sport') === 'wnba' ? 'wnba' : 'tennis';
  return { sport, player: params.get('player') || '', surface: TENNIS_SURFACES.includes(params.get('surface')) ? params.get('surface') : 'All' };
}
export function writeNavigation({ sport, player, surface }) {
  const params = new URLSearchParams(); params.set('sport', sport); if (player) params.set('player', player);
  if (sport === 'tennis' && player && TENNIS_SURFACES.includes(surface)) params.set('surface', surface);
  return `?${params.toString()}`;
}
