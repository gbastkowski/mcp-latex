# Reading Ingest Platform — Technical Report

## Introduction

This document exercises the preset machinery: heading depth, links, tables, code
and glyph fallbacks. Body copy is Palatino; monospace is Menlo.

### Scope

Covers the ingest path from gateway to settlement. Excludes tariff modelling and
the customer-facing portal, which are documented separately.

### Audience

Engineers joining the team, and reviewers assessing the validation rules in
section 4.

## Architecture

### Components

The platform is four services behind one gateway.

| Service | Responsibility | Store |
|---|---|---|
| `receiver` | accept and persist raw readings | Postgres |
| `validator` | apply plausibility rules | none |
| `estimator` | fill gaps in interval series | Postgres |
| `settlement` | aggregate to billing periods | Postgres |

### Data model

A reading is a meter identifier, a decimal value and an instant.

```scala
final case class Reading(meterId: String, value: BigDecimal, at: Instant)
```

Readings are immutable once accepted. Corrections arrive as new readings with a
later `at`, never as updates.

### Interfaces

Each service exposes health and metrics on a side port.

```yaml
endpoints:
  health: /actuator/health
  metrics: /actuator/prometheus
```

## Ingest

### Accepting a batch

The receiver accepts newline-delimited records and returns the count persisted.
Malformed lines are rejected individually rather than failing the batch.

```java
public static Optional<Reading> parse(String line) {
  String[] p = line.split(";");
  return p.length == 3 ? Optional.of(build(p)) : Optional.empty();
}
```

### Idempotency

A batch carries a client-supplied key. Replaying the same key is a no-op, which
makes retries safe after a timeout.

### Backpressure

The gateway sheds load at the connection level once the receiver's queue depth
exceeds its threshold. Clients see `503` and are expected to retry with jitter.

## Validation

### Plausibility rules

Four rules run in order; the first failure short-circuits.

1. The value is non-negative.
2. The value does not exceed the meter's rated maximum.
3. The instant is not in the future.
4. The reading does not precede the meter's installation date.

### Estimation

Where an interval series has gaps, the estimator interpolates linearly between
the bracketing readings. Estimated values are flagged, never silently mixed with
measured ones.

> Estimated readings must not be used for settlement without an explicit
> override. This is a billing requirement, not a technical one.

### Anomalies

A reading that passes all four rules but deviates sharply from the meter's
baseline is accepted and flagged for review.

## Operations

### Metrics

Long identifiers wrap at underscores in table cells:

| Metric | Type | Note |
|---|---|---|
| `http_server_requests_seconds_count` | counter | per endpoint |
| `reading_ingest_batch_duration_seconds` | histogram | p50/p95/p99 |
| `jvm_memory_used_bytes` | gauge | heap and non-heap |
| `validation_rejections_total` | counter | by rule |

### Editor integration

Rendering from the editor is a single call:

```commonlisp
(defun ingest-render (file)
  "Render FILE via the mcp-latex server."
  (interactive "fFile: ")
  (call-process "pandoc" nil "*render*" nil file "-o" "out.pdf"))
```

### Runbook

Arrows and status glyphs come from the shared `common` partial:
→ ← ⇒ ✅ ❌ ⚠ ℹ • ★

- **Queue depth rising** — check the validator's rule latency first.
- **Rejections spiking** — usually a gateway firmware change, not a bug here.
- **Settlement lagging** — verify the estimator finished before the cutoff.

## Configuration

### Server

```json
{ "preset": "ista-report", "toc": "auto", "papersize": "a4" }
```

### Defaults

Sensible defaults mean most callers pass only an input path. See
[the README](https://example.com) for the full argument table.

## Appendix

### Glossary

Interval series
: A sequence of readings at fixed spacing for one meter.

Settlement
: Aggregation of validated readings into a billing period.

### Open questions

Whether estimation should run before or after anomaly detection remains
undecided; the current order was chosen for simplicity, not correctness.
