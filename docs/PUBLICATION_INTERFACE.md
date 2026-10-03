# Triple Threat Player Profile publication interface

This repository is a read-only static consumer of validated upstream artifacts. It does not own Tennis V2 or WNBA aggregation formulas.

## Stable locations

`data/publication-manifest.json` is the browser-facing publication boundary. Each sport points to one immutable release under `data/releases/<sport>/<release-id>/`. Tennis points to its profile, factual history, and authoritative publication receipt as one unit. WNBA points to its profile and release metadata.

Tennis and WNBA entries are loaded independently. A failed sport does not make the other sport unavailable. Future automation may change a sport's manifest paths to stable published URLs without changing the UI, provided the browser can fetch them and the authoritative contracts remain compatible.

## Identity

- Tennis profile identity is exact `Player + Surface`. Until upstream supplies an immutable ID, the canonical player name is the navigation key.
- WNBA profile identity and deep-link key is `PlayerID`. Names are display/search fields only and must never be used as joins.
- URLs carry navigation state only: `sport`, `player`, and, for Tennis, `surface`. Statistical values never travel in the URL.

## Nulls and surfaces

Blank CSV fields and JSON `null` values remain unavailable and display as an em dash where a compact value is needed. Numeric zero remains zero. The UI never backfills a missing value from another source or split.

Tennis surfaces map exactly: `All` to V2 `All`, `Hard` to V2 `Hard`, `Clay` to V2 `Clay`, and `Grass` to V2 `Grass`. There is no surface fallback. A missing `Player + Surface` row produces an explicit unavailable state.

## Tracked samples and recency

The UI presents artifact-provided tracked counts and coverage rather than claiming complete-season coverage. Tennis recent matches are filtered to the selected surface before chronological newest-first selection. Known rows are not removed because optional facts are missing. WNBA recent games use the artifact's played-game-only `RecentGames`, order newest first, and do not replace a newer played game because optional statistics are null. Zero-game WNBA profiles remain selectable and show `No tracked appearances`.

## Independent promotion and last known good

Publication automation must stage candidates outside the stable paths, validate each sport independently, and promote only the sport whose candidate passes. Promotion must be atomic from the consumer's perspective.

1. Generate a sport-specific candidate.
2. Validate contract version, identity uniqueness, required columns/fields, row counts, null semantics, and file readability.
3. On failure, stop for that sport and retain its existing stable artifact and manifest entry.
4. On success, promote the candidate to the stable/versioned location and update only that sport's manifest entry.

Never overwrite the current published file before validation. Tennis failure must not block WNBA promotion, and WNBA failure must not block Tennis promotion. The UI always reads the most recent successfully promoted artifact, including a validated current-day refresh.

Operational commands, validation rules, rollback, retention, and the safe Git handoff are documented in `docs/ARTIFACT_PUBLICATION.md`.
