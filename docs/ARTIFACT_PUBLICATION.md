# Artifact publication operations

The publisher is a Node.js command-line program with no browser, Codex, or third-party package dependency. It validates candidates before writing anything under a stable release path.

## Commands

Validate without promotion:

```text
node scripts/publish-artifacts.mjs validate tennis --manifest <publication-manifest.json> --profile <profile.csv> --history <history.csv>
node scripts/publish-artifacts.mjs validate wnba --profile <profiles.json>
```

Validate, stage, verify, and locally promote one sport:

```text
node scripts/publish-artifacts.mjs publish tennis --manifest <publication-manifest.json> --profile <profile.csv> --history <history.csv>
node scripts/publish-artifacts.mjs publish wnba --profile <profiles.json>
```

Paths are explicit and may be absolute or relative. No user-specific source location is built into the publisher. Failures return a nonzero exit code and do not change the active sport pointer.

Rollback to an existing immutable release:

```text
node scripts/publish-artifacts.mjs rollback tennis --release <release-id>
node scripts/publish-artifacts.mjs rollback wnba --release <release-id>
```

Rollback revalidates the selected release, then changes only that sport's pointer. It does not rebuild statistics.

## Tennis validation and promotion

The supplied Tennis publication receipt is authoritative. The publisher verifies its version, sport, source-derived snapshot ID, both artifact entries, filenames, independently calculated SHA-256 hashes, row counts, required CSV fields, exact `Player + Surface` uniqueness, recognized surfaces, and required factual-history identity fields. Blank optional values remain valid. No timestamp, row-count, latest-date, or content-similarity heuristic is used to infer snapshot identity.

The profile, history, and receipt are staged together in one new immutable directory. The staged copies are revalidated before the product manifest changes. The Tennis pointer therefore cannot expose one artifact from a different release.

## WNBA validation and promotion

The publisher verifies JSON parsing, `wnba-player-profile-v1`, coverage dates, the Profiles collection, unique nonblank `PlayerID`, nonnegative integral `GamesPlayed`, matching Overall game counts, zero-game RecentGames behavior, and absence of prohibited projection, market, odds, LBG, betting, probability, hit-rate, or model-output fields. JSON nulls remain valid.

WNBA stages and promotes independently from Tennis.

## Last known good and interruption behavior

Candidates are validated before staging. Staging uses a temporary directory outside the stable release name, followed by a directory rename. The immutable staged release is validated again. Only then is a temporary product manifest written and renamed over the active manifest. A failure before the final pointer switch leaves the current release active. An interruption after release staging but before pointer promotion may leave an unreferenced complete release, which is safe and may be reused or removed after inspection.

## Git publication handoff

The publisher intentionally performs local promotion only. It never commits, pushes, deploys, force-pushes, or rewrites history. After review, production publication requires a clean repository except for the expected manifest and new sport release files, followed by an ordinary data-publication commit and normal push to `main`. Failed validation creates no commit because Git is outside the validation/promotion command.

## Retention

Keep the current release and at least the immediately previous validated release for each sport. During early operation, retain the latest 12 validated releases per sport. Older unreferenced releases may be removed in a separately reviewed maintenance commit after confirming they are neither the current nor `previousRelease` pointer. Never prune as part of candidate validation or promotion.

The pre-versioned `data/tennis/` and `data/wnba/` files are retained during the initial migration as the prior deployed checkpoint. The live loader follows only the versioned paths in `data/publication-manifest.json`.
