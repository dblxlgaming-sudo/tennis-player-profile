# Tennis V2 Player Profile Contract

`TripleThreat_Tennis_V2_Player_Profile.csv` is the authoritative upstream statistics contract for the future Site Player Profile. Its row identity is `Player + Surface`, where `Surface` is `All`, `Hard`, `Clay`, or `Grass`.

`All` is rebuilt from the player's underlying Raw Match Log observations without a surface filter. It is never an average of the Hard, Clay, and Grass profile rows. Surface rows continue to use the same V2 aggregation definitions with their existing surface restriction.

SPW uses the existing V2 service-points-won definition. A surface row carries the direct `Charting Raw.SPW` value when present. An `All` row uses the existing V2 reconstruction from the aggregate first-serve-in, first-serve-won, and second-serve-won observations. `SPWSource` records the path. Insufficient inputs leave SPW blank.

Win Profile uses `Return Points Won` for the numeric return-score tier. The historical workbook incorrectly bound that variable to `Aces Profile Label`.

The legacy comparison rank and percentile columns have no formulas in the inspected source workbook and their cached population sizes do not match the current profile population. They are not regenerated. `ComparisonRankStatus` is `STALE_NON_AUTHORITATIVE_NOT_REGENERATED`, and the comparison values remain blank until an authoritative methodology is supplied.

All missing statistics remain blank. V2 does not generate scouting prose or qualitative playing-style claims.
