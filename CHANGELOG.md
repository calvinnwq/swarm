# Changelog

## [0.1.0](https://github.com/calvinnwq/swarm/compare/swarm-v0.0.1...swarm-v0.1.0) (2026-04-27)


### Features

* **doc-inputs:** Completed NGX-127 by adding a tested bounded packet materialization API for carry-forward document content and marking the Linear issue Done. ([8fadc12](https://github.com/calvinnwq/swarm/commit/8fadc12b0505c785456f220d9a6bfc4a67a785b8))
* **docs-carry-forward:** Advanced NGX-129 by threading materialized carry-forward document packets into generated seed briefs and dispatched agent prompts. ([fbd86d1](https://github.com/calvinnwq/swarm/commit/fbd86d15d75a0482becdd6eab7b9e2fd108b265c))
* **docs:** Completed NGX-126 by adding deterministic carry-forward doc path resolution and run-start validation, then marked the Linear issue Done with verification notes. ([c27182e](https://github.com/calvinnwq/swarm/commit/c27182e2eba6b52496655c3b466031893ee77905))
* **docs:** Completed NGX-128 by adding provenance-rich carry-forward doc packets, run-level snapshot persistence, verification coverage, and marking the Linear issue Done. ([87dbca1](https://github.com/calvinnwq/swarm/commit/87dbca11809ca0be32e32c7acb883fa3152bae21))
* **lib:** add carry-forward document context ([6fa308c](https://github.com/calvinnwq/swarm/commit/6fa308c73c9e3a06836a2ed462d4d9df277c06cb))


### Bug Fixes

* **carry-forward:** Completed NGX-129 by making resumed runs rehydrate snapshotted carry-forward doc packets and thread them back into resumed briefs and runner dispatch. ([0e2f163](https://github.com/calvinnwq/swarm/commit/0e2f1635cab00348c50561530644a2f554ed499c))
* **doctor:** Added the first NGX-130 hardening slice by making `swarm doctor` validate configured carry-forward docs and report missing paths. ([99c3714](https://github.com/calvinnwq/swarm/commit/99c3714ef63b62c38898f2913eb5b8285e5e4bce))
* **doctor:** Advanced NGX-130 by making `swarm doctor` surface oversized carry-forward docs as bounded-context truncation warnings. ([d9b9ff4](https://github.com/calvinnwq/swarm/commit/d9b9ff4cd2d80a74325e4021ae4d4abff6bc4c0e))
