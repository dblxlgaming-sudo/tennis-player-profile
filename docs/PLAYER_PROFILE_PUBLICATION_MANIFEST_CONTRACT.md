# Tennis V2 Player Profile publication manifest

The normal Player Profile artifact refresh emits the Player Profile CSV, the Player Stat Charts factual-history CSV, and `TripleThreat_Tennis_V2_Player_Profile_Publication_Manifest.json` as one publication unit.

`SnapshotID` is `tennis-v2-snapshot-sha256:` followed by the lowercase SHA-256 of the exact bytes of the source `model_data_latest_export.json`. Filesystem modification times, row counts, and latest match dates are not used as snapshot identity. The source export ID and source timestamps are retained separately as provenance.

The two CSVs are derived from one in-memory load of that source snapshot. Each artifact carries an internal generation receipt with the same SnapshotID. Manifest generation fails if either artifact is absent, if either receipt has a different SnapshotID, or if the receipt identity does not match the supplied source snapshot bytes.

The exporter finalizes both CSVs, hashes their exact on-disk bytes, and writes the manifest last. The manifest is the publication commit marker; consumers must independently verify each artifact SHA-256 and row count before atomic publication.

The manifest contains `ManifestVersion`, `Sport`, `SnapshotID`, `GeneratedAt`, `DataThrough`, source provenance, contract versions, and `Artifacts.PlayerProfile` / `Artifacts.PlayerStatCharts` entries containing `FileName`, `SHA256`, and `Rows`.
