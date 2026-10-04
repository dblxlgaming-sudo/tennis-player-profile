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

Zero-touch production publication after a successful upstream refresh:

```text
node scripts/publish-artifacts.mjs publish tennis --manifest <publication-manifest.json> --profile <profile.csv> --history <history.csv> --production
node scripts/publish-artifacts.mjs publish wnba --profile <profiles.json> --production
```

Production mode retains all local validation and staging rules, then serializes Git publication with `.git/player-profile-publication.lock`. It verifies the canonical repository, `main` branch, expected `origin`, absence of unfinished Git operations, an exact data-only path allowlist, and synchronization with `origin/main`. It creates a concise release-specific commit, runs only `git push origin main`, and polls the canonical Pages manifest until the intended release and live SHA-256 are verified. `--timeout-seconds <seconds>` and `--live-url <url>` are available for controlled environments.

Validate-only and local publish commands never commit or push. Production mode requires noninteractive Git credentials suitable for a normal push to `origin/main`.

Rollback to an existing immutable release:

```text
node scripts/publish-artifacts.mjs rollback tennis --release <release-id>
node scripts/publish-artifacts.mjs rollback wnba --release <release-id>
```

Rollback revalidates the selected release, then changes only that sport's pointer. It does not rebuild statistics.

Production rollback uses the same safety, commit, push, Pages, and hash-verification path:

```text
node scripts/publish-artifacts.mjs rollback tennis --release <release-id> --production
node scripts/publish-artifacts.mjs rollback wnba --release <release-id> --production
```

## Tennis validation and promotion

The supplied Tennis publication receipt is authoritative. The publisher verifies its version, sport, source-derived snapshot ID, both artifact entries, filenames, independently calculated SHA-256 hashes, row counts, required CSV fields, exact `Player + Surface` uniqueness, recognized surfaces, and required factual-history identity fields. Blank optional values remain valid. No timestamp, row-count, latest-date, or content-similarity heuristic is used to infer snapshot identity.

The profile, history, and receipt are staged together in one new immutable directory. The staged copies are revalidated before the product manifest changes. The Tennis pointer therefore cannot expose one artifact from a different release.

## WNBA validation and promotion

The publisher verifies JSON parsing, `wnba-player-profile-v1`, coverage dates, the Profiles collection, unique nonblank `PlayerID`, nonnegative integral `GamesPlayed`, matching Overall game counts, zero-game RecentGames behavior, and absence of prohibited projection, market, odds, LBG, betting, probability, hit-rate, or model-output fields. JSON nulls remain valid.

WNBA stages and promotes independently from Tennis.

## Last known good and interruption behavior

Candidates are validated before staging. Staging uses a temporary directory outside the stable release name, followed by a directory rename. The immutable staged release is validated again. Only then is a temporary product manifest written and renamed over the active manifest. A failure before the final pointer switch leaves the current release active. An interruption after release staging but before pointer promotion may leave an unreferenced complete release, which is safe and may be reused or removed after inspection.

## Git publication and recovery

Production mode permits only `data/publication-manifest.json` and the exact files for the affected immutable release. Unexpected dirty or staged paths stop publication without cleanup. It never resets work, merges, rebases, force-pushes, or rewrites history.

If local promotion or commit succeeds but push fails, the validated release is retained and the command reports `LOCAL is newer than LIVE`. Re-running the same production command safely recognizes the allowlisted ahead commit and retries the normal push without regenerating statistics. If push succeeds but Pages times out, re-running the same command is idempotent and resumes live verification. Behind or diverged remote state stops with a retry requirement and is never reconciled automatically.

Result classes are reported distinctly: `VALIDATION_FAILURE`, `LOCAL_PROMOTION_FAILURE`, `GIT_SAFETY_FAILURE`, `COMMIT_FAILURE`, `PUSH_FAILURE`, `PAGES_DEPLOYMENT_TIMEOUT`, `LIVE_HASH_VERIFICATION_FAILURE`, and `SUCCESS`.

## Upstream zero-touch contract

After its normal refresh has successfully generated the complete candidate unit, Tennis invokes the Tennis production command with all three explicit paths. WNBA invokes the WNBA production command with its generated JSON path. Invocation occurs only after upstream generation succeeds. The publisher performs validation, promotion, Git publication, Pages waiting, and live verification without Codex or operator file transfer.

Tennis currently calling local-only `publish tennis` needs one minimal integration change after this implementation is deployed: append `--production` and provide noninteractive normal-push credentials in that runtime. WNBA needs to add the documented `publish wnba ... --production` call after its successful normal artifact generation, with the same repository checkout and credential requirement.

## Retention

Keep the current release and at least the immediately previous validated release for each sport. During early operation, retain the latest 12 validated releases per sport. Older unreferenced releases may be removed in a separately reviewed maintenance commit after confirming they are neither the current nor `previousRelease` pointer. Never prune as part of candidate validation or promotion.

The pre-versioned `data/tennis/` and `data/wnba/` files are retained during the initial migration as the prior deployed checkpoint. The live loader follows only the versioned paths in `data/publication-manifest.json`.
