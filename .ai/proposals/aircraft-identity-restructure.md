# Aircraft Identity Restructure

## Problem

The current `aircrafts` table is being used as a single persistent store for
resolved aircraft identity, but it is too flat for the actual data flow in this
project.

Today it only stores:

- `icao24`
- `registration`
- `manufacturer`
- `type`
- `registered_owner`
- `updated_ts`

That shape is useful as a small cache, but it is not expressive enough for the
real enrichment pipeline:

- live feed data can disagree with enrichment
- `adsbdb` can be wrong or incomplete, especially for rare, military, or
  non-standard aircraft
- local enrichment tiers can infer values with varying confidence
- the app currently has no native place to keep alternative observations,
  provenance, or conflict state

## What is missing

The database needs a way to distinguish between:

- the best current value we want to show
- raw observations from individual sources
- uncertain or conflicting claims
- manual or future overrides

Without that separation, the table stays shallow and lossy.

## Candidate directions

### Option A: Keep one canonical table and add provenance columns

Add fields such as:

- `source`
- `confidence`
- `status`
- `first_seen_ts`
- `last_seen_ts`

This is the smallest change, but it still only keeps one row per aircraft and
does not preserve competing values well.

### Option B: Canonical table plus observation table

Use two layers:

- `aircrafts` for the current canonical record
- `aircraft_observations` for every source/value pair we have seen

Possible observation fields:

- `icao24`
- `field`
- `value`
- `source`
- `confidence`
- `observed_ts`
- `needs_corroboration`

This keeps the table honest when enrichment is uncertain and makes military or
rare aircraft much easier to handle.

### Option C: Canonical table plus per-field current view

Use:

- `aircrafts` for the entity
- `aircraft_observations` for raw data
- a derived `aircraft_field_current` view or materialized table for fast UI reads

This is the cleanest model if the project wants to keep growing.

## Recommendation

If we do this later, the best fit for this project is probably:

1. keep `aircrafts` as the canonical aircraft entity
2. add `aircraft_observations` for provenance and alternate values
3. derive the displayed values from explicit source-priority rules

That would let the app keep showing a simple UI while avoiding data loss.

## Notes

- `identity_history` is currently too narrow to solve this by itself; it only
  records changes to a small subset of fields, not competing observations.
- Rare and military aircraft are exactly where a provenance-aware design matters
  most, because the current enrichment path is most likely to be wrong there.
- This is a design note only. No implementation decision has been made yet.
