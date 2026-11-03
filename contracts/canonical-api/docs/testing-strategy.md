# Canonical API Contract Testing Strategy

- **Status:** Current
- **Owns:** Contract syntax/semantics, security hygiene, generator, projection,
  determinism, and generated-artifact boundary checks
- **Read after:** [`architecture.md`](architecture.md)
- **Mandatory before:** Changing `openapi.yaml`, generation configuration,
  validator logic, or manifest projection

## Required Layers

| Layer | Evidence |
| --- | --- |
| Parser | OpenAPI parser reports no errors and resolves the document |
| Semantic validator | Stable unique operation IDs, explicit ingress, supported surface, Problem Details, and secret hygiene |
| Generator prototype | Kotlin/Spring interfaces and models are emitted for representative and complete operations |
| Manifest projection | Manifest equals all and only `canonical` and `provider-callback` operations; `none` is excluded |
| Determinism | Repeated normalized projections are byte-identical |
| Artifact boundary | Generated outputs remain under `build/` and are not tracked |

Approved secret-bearing request/response properties may be declared. Tests
reject examples/defaults on those fields, known sentinel or environment values,
and secrets in path/query parameters or URL examples.

## Command

Run Gradle commands serially:

```bash
./gradlew --no-daemon :contracts:canonical-api:qualityCheck
```
