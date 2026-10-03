import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTennisIndex, buildWnbaIndex, display, getTennisProfile, getWnbaProfile, parseCsv, readNavigation, recentTennisMatches, recentWnbaGames, writeNavigation } from '../src/profile-core.js';

test('entry has no default player and sport navigation is supported', () => {
  assert.deepEqual(readNavigation(''), { sport: 'tennis', player: '', surface: 'All' });
  assert.equal(readNavigation('?sport=wnba').sport, 'wnba');
});
test('player search UI and both sports are present', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /type="search"/); assert.match(html, /data-sport="tennis"/); assert.match(html, /data-sport="wnba"/); assert.doesNotMatch(html, /Ajla Tomljanovic/i);
});
test('CSV parser preserves blanks and quoted values', () => {
  assert.deepEqual(parseCsv('Player,Surface,Value\n"Doe, Jane",All,0\nJane,Hard,\n'), [{ Player: 'Doe, Jane', Surface: 'All', Value: '0' }, { Player: 'Jane', Surface: 'Hard', Value: '' }]);
});
test('Tennis lookup is exact and All never falls back to Hard', () => {
  const index = buildTennisIndex([{ Player: 'A', Surface: 'Hard', WinPct: '0.5' }, { Player: 'B', Surface: 'All', WinPct: '0.6' }]);
  assert.equal(getTennisProfile(index, 'A', 'Hard').WinPct, '0.5'); assert.equal(getTennisProfile(index, 'A', 'All'), null); assert.equal(getTennisProfile(index, 'A', 'Clay'), null);
});
test('surface filtering precedes Tennis recency and incomplete newer rows remain', () => {
  const rows = [{ Player: 'A', Surface: 'Clay', Date: '2026-01-01', Opponent: 'old clay', FinalScore: '6-4' }, { Player: 'A', Surface: 'Hard', Date: '2026-04-01', Opponent: 'hard' }, { Player: 'A', Surface: 'Clay', Date: '2026-03-01', Opponent: 'new incomplete', FinalScore: '' }, { Player: 'A', Surface: 'Clay', Date: '2026-02-01', Opponent: 'middle clay', FinalScore: '6-2' }];
  assert.deepEqual(recentTennisMatches(rows, 'A', 'Clay', 2).map((row) => row.Opponent), ['new incomplete', 'middle clay']);
});
test('WNBA identity uses PlayerID so duplicate names do not collide', () => {
  const index = buildWnbaIndex({ Profiles: [{ PlayerID: 'espn:1', PlayerName: 'Same' }, { PlayerID: 'espn:2', PlayerName: 'Same' }] });
  assert.equal(index.profiles.size, 2); assert.equal(getWnbaProfile(index, 'Same'), null); assert.equal(getWnbaProfile(index, 'espn:2').PlayerID, 'espn:2');
});
test('WNBA recency keeps newer played games with missing optional stats', () => {
  const profile = { RecentGames: [{ Date: '2026-01-01', Points: 10 }, { Date: '2026-04-01', Status: 'did_not_play' }, { Date: '2026-03-01', Points: null }, { Date: '2026-02-01', Points: 12 }] };
  assert.deepEqual(recentWnbaGames(profile, 2).map((game) => game.Date), ['2026-03-01', '2026-02-01']);
});
test('zero and null remain distinct', () => { assert.equal(display(0), '0'); assert.equal(display(null), '—'); assert.equal(display(''), '—'); });
test('deep links contain identity/navigation only', () => {
  const tennis = writeNavigation({ sport: 'tennis', player: 'Victoria Azarenka', surface: 'Clay' }); const wnba = writeNavigation({ sport: 'wnba', player: 'espn:123', surface: 'All' });
  assert.equal(tennis, '?sport=tennis&player=Victoria+Azarenka&surface=Clay'); assert.equal(wnba, '?sport=wnba&player=espn%3A123'); assert.doesNotMatch(tennis + wnba, /win|rank|points|stat/i);
});
test('removed concepts and graphs are absent; responsive layouts exist', () => {
  const combined = ['../index.html', '../app.js', '../styles.css'].map((path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(combined, /How She Compares|Population Comparison|Market Research/i); assert.doesNotMatch(combined, /<canvas|<svg|bar chart|line chart|radar chart|spider chart|hit-rate graph/i); assert.doesNotMatch(combined, /holdrank|holdpct|ComparisonRank|ComparisonPercentile/); assert.match(combined, /@media \(max-width: 760px\)/); assert.match(combined, /grid-template-columns: repeat\(2/);
});
test('WNBA zero-game and tracked-coverage states are implemented', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8'); assert.match(app, /No tracked appearances/); assert.match(app, /coverage/);
});
test('sport artifacts load independently', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8'); assert.match(app, /Promise\.allSettled/); assert.match(app, /errors\.tennis/); assert.match(app, /errors\.wnba/);
});
