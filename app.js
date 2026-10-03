import { TENNIS_SURFACES, buildTennisIndex, buildWnbaIndex, display, getTennisProfile, getWnbaProfile, isMissing, parseCsv, readNavigation, recentTennisMatches, recentWnbaGames, writeNavigation } from './src/profile-core.js';

const state = { sport: 'tennis', player: '', surface: 'All', tennis: null, wnba: null, errors: {} };
const els = Object.fromEntries(['status','player-picker','picker-sport','player-count','player-search','player-results','profile'].map((id) => [id, document.getElementById(id)]));
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const number = (value) => isMissing(value) ? null : Number(value);
const fixed = (digits = 1) => (value) => Number(value).toFixed(digits);
const pct = (value) => `${(Number(value) * 100).toFixed(1)}%`;
const dateLabel = (value) => {
  if (isMissing(value)) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const rangeLabel = (start, end) => isMissing(start) || isMissing(end) ? '—' : `${dateLabel(start)} – ${dateLabel(end)}`;

async function fetchText(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
}

async function loadPublishedData() {
  const manifestResponse = await fetch('./data/publication-manifest.json', { cache: 'no-cache' });
  if (!manifestResponse.ok) throw new Error(`Publication manifest: HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  const tennisPromise = Promise.all([fetchText(manifest.sports.tennis.profile), fetchText(manifest.sports.tennis.history)])
    .then(([profileCsv, historyCsv]) => ({ ...buildTennisIndex(parseCsv(profileCsv)), history: parseCsv(historyCsv), publication: manifest.sports.tennis }));
  const wnbaPromise = fetch(manifest.sports.wnba.profile, { cache: 'no-cache' }).then((response) => {
    if (!response.ok) throw new Error(`${manifest.sports.wnba.profile}: HTTP ${response.status}`);
    return response.json();
  }).then((artifact) => ({ ...buildWnbaIndex(artifact), publication: manifest.sports.wnba }));
  const [tennis, wnba] = await Promise.allSettled([tennisPromise, wnbaPromise]);
  if (tennis.status === 'fulfilled') state.tennis = tennis.value; else state.errors.tennis = tennis.reason.message;
  if (wnba.status === 'fulfilled') state.wnba = wnba.value; else state.errors.wnba = wnba.reason.message;
}

function setStatus(message = '', error = false) { els.status.textContent = message; els.status.classList.toggle('error', error); }
function syncUrl(replace = false) { history[replace ? 'replaceState' : 'pushState'](null, '', writeNavigation(state)); }
function metric(label, value, formatter = String, note = '') {
  const missing = isMissing(value) || (typeof value === 'number' && Number.isNaN(value));
  if (missing) return '';
  return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(formatter(value))}</div>${note ? `<div class="section-note">${esc(note)}</div>` : ''}</div>`;
}
function section(title, metrics) {
  const available = metrics.filter(Boolean);
  return `<section class="data-section"><h3>${esc(title)}</h3>${available.length ? `<div class="metric-grid">${available.join('')}</div>` : '<p class="section-note">No authoritative values available.</p>'}</section>`;
}

function updateSportTabs() {
  document.querySelectorAll('.sport-tab').forEach((button) => {
    const active = button.dataset.sport === state.sport;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
}

function showPicker() {
  els.profile.hidden = true; els['player-picker'].hidden = false; els['picker-sport'].textContent = state.sport.toUpperCase();
  els['player-search'].value = ''; renderPlayerResults('');
}

function renderPlayerResults(query) {
  const source = state.sport === 'tennis' ? state.tennis?.players : state.wnba?.players;
  if (!source) { els['player-count'].textContent = ''; els['player-results'].innerHTML = `<div class="empty-state">${esc(state.errors[state.sport] || 'Player data is unavailable.')}</div>`; return; }
  const needle = query.trim().toLocaleLowerCase();
  const matches = source.filter((item) => (typeof item === 'string' ? item : item.PlayerName).toLocaleLowerCase().includes(needle));
  els['player-count'].textContent = `${matches.length} player${matches.length === 1 ? '' : 's'}`;
  els['player-results'].innerHTML = matches.length ? matches.slice(0, 150).map((item) => {
    const name = typeof item === 'string' ? item : item.PlayerName;
    const id = typeof item === 'string' ? item : item.PlayerID;
    const context = typeof item === 'string' ? 'Tennis' : [item.CurrentTeam?.TeamName, item.Position].filter(Boolean).join(' · ');
    return `<button class="player-option" type="button" data-player="${esc(id)}"><strong>${esc(name)}</strong><span>${esc(context || 'WNBA')}</span></button>`;
  }).join('') : '<div class="empty-state">No matching players.</div>';
}

function tennisScouting(row) {
  const sentences = [];
  if (!isMissing(row.WinPct) && !isMissing(row.TrackedMatchCount)) sentences.push(`${pct(row.WinPct)} wins across ${row.TrackedMatchCount} tracked ${row.Surface.toLowerCase()} matches.`);
  else if (!isMissing(row.TrackedMatchCount)) sentences.push(`${row.TrackedMatchCount} tracked ${row.Surface.toLowerCase()} matches.`);
  if (!isMissing(row.ServeProfileLabel)) sentences.push(`Serve profile: ${row.ServeProfileLabel}.`);
  if (!isMissing(row.ReturnProfileLabel)) sentences.push(`Return profile: ${row.ReturnProfileLabel}.`);
  if (!isMissing(row.BreakpointPressureLabel)) sentences.push(`Breakpoint pressure: ${row.BreakpointPressureLabel}.`);
  return sentences.join(' ') || 'No authoritative scouting summary is available for this surface.';
}

function surfaceTabs(active) {
  return TENNIS_SURFACES.map((surface) => `<button type="button" class="surface-tab${surface === active ? ' active' : ''}" data-surface="${surface}" aria-pressed="${surface === active}">${surface}</button>`).join('');
}

function renderTennis(player, surface) {
  const row = getTennisProfile(state.tennis, player, surface);
  const shellStart = `<div class="profile-nav"><button class="back-button" type="button" data-action="players">← Players</button><span class="sport-label">TENNIS</span></div>`;
  if (!row) {
    els.profile.innerHTML = `${shellStart}<section class="identity"><h2>${esc(player)}</h2><div class="surface-tabs">${surfaceTabs(surface)}</div></section><div class="unavailable">No authoritative ${esc(surface)} profile is available for this player. No other surface has been substituted.</div>`;
    return;
  }
  const matches = recentTennisMatches(state.tennis.history, player, surface, 5);
  const performance = section('Performance', [metric('Win %', number(row.WinPct), pct), metric('Tracked Matches', number(row.TrackedMatchCount), fixed(0)), metric('Three-set Rate', number(row.ThreeSetRate), pct), metric('Avg Games Won', number(row.GamesWonAvg), fixed(1)), metric('Avg Total Games', number(row.AvgMatchGames), fixed(1))]);
  const control = section('Control & Pressure', [metric('Dominance Ratio', number(row.DR), fixed(2)), metric('Total Points Won', number(row.TPW), pct), metric('BP Saved %', number(row.BPSavedPct), pct), metric('Stability', number(row.StabilityScore), fixed(1)), metric('Separation', row.SeparationProfile), metric('Resistance', row.ResistanceProfile), metric('Win Profile', row.WinProfile), metric('Surface Edge', row.SurfaceEdge)]);
  const serve = section('Serve Profile', [metric('Hold %', number(row.HoldPct), pct), metric('SPW', number(row.SPW), pct), metric('1st Serve In %', number(row.FirstServeInPct), pct), metric('1st Serve Won %', number(row.FirstServeWonPct), pct), metric('2nd Serve Won %', number(row.SecondServeWonPct), pct), metric('Aces / Match', number(row.AcesPerMatch), fixed(1)), metric('DFs / Match', number(row.DoubleFaultsPerMatch), fixed(1)), metric('V2 Serve Profile', row.ServeProfileLabel)]);
  const returns = section('Return Profile', [metric('Break %', number(row.BreakPct), pct), metric('Return Points Won', number(row.ReturnPointsWon), pct), metric('BP Created / Match', number(row.BPCreatedPerMatch), fixed(1)), metric('BP Converted', number(row.BPConvertedPct), pct), metric('V2 Return Profile', row.ReturnProfileLabel), metric('Breakpoint Pressure', row.BreakpointPressureLabel)]);
  els.profile.innerHTML = `${shellStart}<section class="identity"><div class="identity-main"><div><h2>${esc(player)}</h2><div class="identity-context"><span>${esc(row.DataQualityFlag || 'Tracked profile')}</span><span>${display(row.TrackedMatchCount)} tracked matches</span><span>${esc(surface)} surface</span></div></div></div><div class="surface-tabs">${surfaceTabs(surface)}</div></section><section class="scouting"><h3>Scouting Summary</h3><p>${esc(tennisScouting(row))}</p></section><div class="section-grid">${performance}${control}${serve}${returns}</div>${tennisMatchesTable(matches)}`;
}

function tennisMatchesTable(matches) {
  const rows = matches.map((match) => `<tr><td>${esc(dateLabel(match.Date))}</td><td>${esc(display(match.Opponent))}</td><td>${esc(display(match.OpponentRank))}</td><td>${esc(display(match.Surface))}</td><td>${esc(display(match.FinalScore))}</td><td class="${match.Result === 'W' ? 'result-win' : match.Result === 'L' ? 'result-loss' : ''}">${esc(display(match.Result))}</td><td>${esc(display(match.MatchStatus))}</td></tr>`).join('');
  return `<section class="recent-section"><div class="section-heading"><h3>Recent Matches</h3><span class="section-note">Newest tracked contests first · ${esc(state.surface)}</span></div>${rows ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Opponent</th><th>Opponent Rank</th><th>Surface</th><th>Final Score</th><th>W/L</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state">No tracked contests are available for this surface.</div>'}</section>`;
}

function wnbaScouting(profile) {
  if (!profile.GamesPlayed) return 'No tracked appearances; no performance summary is generated.';
  const overall = profile.Overall; const facts = [`${overall.GamesPlayed} tracked games`]; const performance = overall.Performance || {};
  if (!isMissing(performance.Minutes?.PerGame)) facts.push(`${fixed(1)(performance.Minutes.PerGame)} minutes per game`);
  if (!isMissing(performance.Points?.PerGame)) facts.push(`${fixed(1)(performance.Points.PerGame)} points`);
  if (!isMissing(performance.Rebounds?.PerGame)) facts.push(`${fixed(1)(performance.Rebounds.PerGame)} rebounds`);
  if (!isMissing(performance.Assists?.PerGame)) facts.push(`${fixed(1)(performance.Assists.PerGame)} assists`);
  return `${facts.join(', ')}. Tracked sample ${rangeLabel(overall.TrackedDateStart, overall.TrackedDateEnd)}.`;
}

function perGameMetric(label, object) { return metric(label, object?.PerGame, fixed(1), isMissing(object?.ObservedGames) ? '' : `${object.ObservedGames} observed games`); }

function renderWnba(playerId) {
  const profile = getWnbaProfile(state.wnba, playerId);
  const shellStart = `<div class="profile-nav"><button class="back-button" type="button" data-action="players">← Players</button><span class="sport-label">WNBA</span></div>`;
  if (!profile) { els.profile.innerHTML = `${shellStart}<div class="unavailable">This PlayerID is not present in the published WNBA artifact.</div>`; return; }
  const context = [profile.CurrentTeam?.TeamName, profile.Position, `${profile.GamesPlayed} tracked games`].filter(Boolean);
  const headshot = profile.HeadshotURL ? `<img class="headshot" src="${esc(profile.HeadshotURL)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
  const identity = `${shellStart}<section class="identity"><div class="identity-main"><div><h2>${esc(profile.PlayerName)}</h2><div class="identity-context">${context.map((item) => `<span>${esc(item)}</span>`).join('')}<span>Tracked sample: ${esc(rangeLabel(state.wnba.coverage?.TrackedDateStart, state.wnba.coverage?.TrackedDateEnd))}</span></div></div>${headshot}</div></section>`;
  if (!profile.GamesPlayed) { els.profile.innerHTML = `${identity}<div class="zero-state"><strong>No tracked appearances</strong><span>Player identity is available, but no played-game performance sample is present.</span></div>`; return; }
  const overall = profile.Overall; const shooting = overall.Shooting || {};
  const performance = section('Performance', [metric('Games Played', overall.GamesPlayed, fixed(0)), metric('Starts', overall.Starts, fixed(0)), metric('Starter Frequency', overall.StarterFrequency, pct), perGameMetric('Minutes', overall.Performance?.Minutes), perGameMetric('Points', overall.Performance?.Points), perGameMetric('Rebounds', overall.Performance?.Rebounds), perGameMetric('Assists', overall.Performance?.Assists), perGameMetric('Turnovers', overall.Performance?.Turnovers)]);
  const scoring = section('Scoring', [perGameMetric('Points', overall.Performance?.Points), metric('FGM / FGA', shooting.FieldGoals?.Attempts, () => `${display(shooting.FieldGoals?.Makes, fixed(0))} / ${display(shooting.FieldGoals?.Attempts, fixed(0))}`), metric('FG%', shooting.FieldGoals?.Percentage, pct), metric('3PM / 3PA', shooting.ThreePointers?.Attempts, () => `${display(shooting.ThreePointers?.Makes, fixed(0))} / ${display(shooting.ThreePointers?.Attempts, fixed(0))}`), metric('3P%', shooting.ThreePointers?.Percentage, pct), metric('FTM / FTA', shooting.FreeThrows?.Attempts, () => `${display(shooting.FreeThrows?.Makes, fixed(0))} / ${display(shooting.FreeThrows?.Attempts, fixed(0))}`), metric('FT%', shooting.FreeThrows?.Percentage, pct), metric('Points / Minute', shooting.PointsPerMinute, fixed(3))]);
  const playmaking = section('Playmaking', [perGameMetric('Assists', overall.Playmaking?.Assists), perGameMetric('Turnovers', overall.Playmaking?.Turnovers), metric('Assist / Turnover', overall.Playmaking?.AssistTurnoverRatio, fixed(2))]);
  const reboundDefense = section('Rebounding / Defense', [perGameMetric('Offensive Rebounds', overall.Rebounding?.OffensiveRebounds), perGameMetric('Defensive Rebounds', overall.Rebounding?.DefensiveRebounds), perGameMetric('Total Rebounds', overall.Rebounding?.TotalRebounds), perGameMetric('Steals', overall.Defense?.Steals), perGameMetric('Blocks', overall.Defense?.Blocks)]);
  els.profile.innerHTML = `${identity}<section class="scouting"><h3>Scouting Summary</h3><p>${esc(wnbaScouting(profile))}</p></section><div class="section-grid">${performance}${scoring}${playmaking}${reboundDefense}</div>${wnbaGamesTable(recentWnbaGames(profile, 5))}`;
}

function wnbaGamesTable(games) {
  const rows = games.map((game) => `<tr><td>${esc(dateLabel(game.Date))}</td><td>${esc(display(game.Opponent))}</td><td>${esc(display(game.HomeAway, (value) => value === 'home' ? 'Home' : value === 'away' ? 'Away' : value))}</td><td class="${game.Result === 'W' ? 'result-win' : game.Result === 'L' ? 'result-loss' : ''}">${esc(display(game.Result))}</td><td>${esc(display(game.Minutes, fixed(0)))}</td><td>${esc(display(game.Points, fixed(0)))}</td><td>${esc(display(game.Rebounds, fixed(0)))}</td><td>${esc(display(game.Assists, fixed(0)))}</td></tr>`).join('');
  return `<section class="recent-section"><div class="section-heading"><h3>Recent Games</h3><span class="section-note">Latest tracked played games</span></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Opponent</th><th>Home/Away</th><th>W/L</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function render() {
  updateSportTabs(); setStatus(''); const data = state[state.sport];
  if (!data) { showPicker(); setStatus(`${state.sport.toUpperCase()} data is unavailable. ${state.errors[state.sport] || ''}`, true); return; }
  if (!state.player) { showPicker(); return; }
  els['player-picker'].hidden = true; els.profile.hidden = false;
  if (state.sport === 'tennis') renderTennis(state.player, state.surface); else renderWnba(state.player);
}

document.querySelector('.sport-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-sport]'); if (!button) return;
  state.sport = button.dataset.sport; state.player = ''; state.surface = 'All'; syncUrl(); render();
});
els['player-search'].addEventListener('input', (event) => renderPlayerResults(event.target.value));
els['player-results'].addEventListener('click', (event) => {
  const button = event.target.closest('[data-player]'); if (!button) return;
  state.player = button.dataset.player; state.surface = 'All'; syncUrl(); render();
});
els.profile.addEventListener('click', (event) => {
  const surfaceButton = event.target.closest('[data-surface]');
  if (surfaceButton) { state.surface = surfaceButton.dataset.surface; syncUrl(); render(); return; }
  if (event.target.closest('[data-action="players"]')) { state.player = ''; state.surface = 'All'; syncUrl(); render(); }
});
window.addEventListener('popstate', () => { Object.assign(state, readNavigation(location.search)); render(); });
Object.assign(state, readNavigation(location.search));
loadPublishedData().then(render).catch((error) => { setStatus(`Player data could not be loaded. ${error.message}`, true); showPicker(); });
