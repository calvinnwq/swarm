# Changelog

## [0.2.0](https://github.com/calvinnwq/swarm/compare/swarm-v0.1.0...swarm-v0.2.0) (2026-04-28)


### Features

* add configurable swarm run timeout ([641feee](https://github.com/calvinnwq/swarm/commit/641feeee289ce3382f13bee5a09462edcc082b79))
* add LLM-driven orchestrator resolution ([8f3f1fb](https://github.com/calvinnwq/swarm/commit/8f3f1fb4bc89800e3ff137ee1c53dc2437db2dfe))
* **artifact-validator:** add offline artifact integrity validator (NGX-148) ([185d14a](https://github.com/calvinnwq/swarm/commit/185d14a4f00a5a964bc35bbfa3c2c9ae294a290f))
* **cli:** add configurable run timeout ([4eb9d74](https://github.com/calvinnwq/swarm/commit/4eb9d74decd06a78d24ee0bf2094da1288de8184))
* **doctor:** harden doctor with actionable messages for missing-binary and harness attribution (NGX-150) ([695a977](https://github.com/calvinnwq/swarm/commit/695a977b373793bfafd8b546bc0c546ba04516a3))
* **lib:** add offline artifact validation ([ea9d3d7](https://github.com/calvinnwq/swarm/commit/ea9d3d7cabadd55c382f6fb0ee9d4f36c2c216c3))
* **orchestrator:** add buildOrchestratorResolutionPrompt (NGX-155) ([628dba1](https://github.com/calvinnwq/swarm/commit/628dba1d680f59f1af217ff9a5cdaca424c033ef))
* **orchestrator:** add OrchestratorOutputSchema and validation helpers (NGX-154) ([a2195d0](https://github.com/calvinnwq/swarm/commit/a2195d07c12badc500cc7b0172df71055adf7dfb))
* **orchestrator:** aggregate question resolutions and deferred questions (NGX-157) ([2eae7b3](https://github.com/calvinnwq/swarm/commit/2eae7b3883b0495dd3edd1704096afc292c56f53))
* **orchestrator:** persist orchestrator passes to checkpoint and ledger (NGX-158) ([c3f26eb](https://github.com/calvinnwq/swarm/commit/c3f26eb02f5de6c7428b1ce7991c28b13f0cd38b))
* **orchestrator:** wire dispatchOrchestratorPass into between-round resolution (NGX-156) ([39456db](https://github.com/calvinnwq/swarm/commit/39456db6a1ce2b86c163961d6c0a035867188297))
* **smoke-runner:** manual real-harness smoke gate (NGX-143) ([f276f9e](https://github.com/calvinnwq/swarm/commit/f276f9ecb348f3605aa6bb695941ef0f06005137))


### Bug Fixes

* **codex:** set additionalProperties: false on output schema (NGX-142) ([80272d9](https://github.com/calvinnwq/swarm/commit/80272d953022a8bb436db431202b8886d1e718e1))

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
