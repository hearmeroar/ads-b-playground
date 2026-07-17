"""Identity enrichment: local static lookup tables that fill gaps in
aircraft identity data (country, operator, manufacturer/model, year built)
using registration prefixes, a placeholder ICAO24 database, ICAO airline
callsign designators, and aircraft type normalization. No external API, no
database — see aircraft_enrichment.enrich_identity() for the entry point.
"""
