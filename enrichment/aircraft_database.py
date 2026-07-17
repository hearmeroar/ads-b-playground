"""Two related but distinct lookups:

1. ICAO24 (transponder hex) -> a full placeholder aircraft record, behind a
   swappable interface so a real data source can replace the static table
   later without any caller changes.
2. Aircraft type code / free-text description -> manufacturer + model, a
   pure normalization table (no swappable interface needed — it's a small,
   stable, well-known ICAO type-designator vocabulary, not something that
   plausibly gets replaced by an external service the way (1) might).
"""

from .countries import country_by_iso


class AircraftDatabaseLookup:
    """Interface: implement lookup(icao24) -> dict|None in this shape to
    plug in a real data source later without touching any caller.
    """

    def lookup(self, icao24):
        raise NotImplementedError


# Keyed by lowercase hex. country_iso resolved through countries.py so the
# country name stays in sync with every other module.
_PLACEHOLDER_RECORDS = {
    "49d3d3": {
        "registration": "OK-SWC", "operator": "Smartwings", "country_iso": "CZ",
        "manufacturer": "Boeing", "model": "737 MAX 8", "year_built": 2021,
    },
    "4b1814": {
        "registration": "HB-JCA", "operator": "Swiss International Air Lines", "country_iso": "CH",
        "manufacturer": "Airbus", "model": "A320neo", "year_built": 2018,
    },
    "406b2e": {
        "registration": "G-EZTE", "operator": "easyJet", "country_iso": "GB",
        "manufacturer": "Airbus", "model": "A320neo", "year_built": 2019,
    },
    "3c6754": {
        "registration": "D-AIBL", "operator": "Lufthansa", "country_iso": "DE",
        "manufacturer": "Airbus", "model": "A319", "year_built": 2010,
    },
    "3944ee": {
        "registration": "F-GRHS", "operator": "Air France", "country_iso": "FR",
        "manufacturer": "Airbus", "model": "A320", "year_built": 2007,
    },
    "4ca7b1": {
        "registration": "EI-DVM", "operator": "Ryanair", "country_iso": "IE",
        "manufacturer": "Boeing", "model": "737-800", "year_built": 2009,
    },
    "484506": {
        "registration": "PH-BHA", "operator": "KLM Royal Dutch Airlines", "country_iso": "NL",
        "manufacturer": "Boeing", "model": "787-9", "year_built": 2015,
    },
}


class StaticAircraftDatabaseLookup(AircraftDatabaseLookup):
    def __init__(self, records=None):
        self._records = records if records is not None else _PLACEHOLDER_RECORDS

    def lookup(self, icao24):
        if not icao24:
            return None
        record = self._records.get(icao24.strip().lower())
        if not record:
            return None
        country = country_by_iso(record.get("country_iso"))
        return {
            "registration": record.get("registration"),
            "operator": record.get("operator"),
            "country": country["name"] if country else None,
            "country_iso": country["iso"] if country else None,
            "manufacturer": record.get("manufacturer"),
            "model": record.get("model"),
            "year_built": record.get("year_built"),
            "source": "icao24_lookup",
            "confidence": 1.0,
        }


DEFAULT_AIRCRAFT_DATABASE = StaticAircraftDatabaseLookup()


TYPE_CODE_TABLE = {
    "B38M": {"manufacturer": "Boeing", "model": "737 MAX 8"},
    "A20N": {"manufacturer": "Airbus", "model": "A320neo"},
    "A21N": {"manufacturer": "Airbus", "model": "A321neo"},
    "B738": {"manufacturer": "Boeing", "model": "737-800"},
    "B739": {"manufacturer": "Boeing", "model": "737-900"},
    "A320": {"manufacturer": "Airbus", "model": "A320"},
    "A319": {"manufacturer": "Airbus", "model": "A319"},
    "B788": {"manufacturer": "Boeing", "model": "787-8"},
    "B789": {"manufacturer": "Boeing", "model": "787-9"},
    "B763": {"manufacturer": "Boeing", "model": "767-300"},
    "C172": {"manufacturer": "Cessna", "model": "172"},
}

# Free-text descriptions as reported by adsb.fi/airplanes.live's "desc"
# field or a callsign-adjacent human label — normalized separately from the
# ICAO code table since the two vocabularies don't overlap key-for-key.
TYPE_DESC_TABLE = {
    "B737 MAX 8": {"manufacturer": "Boeing", "model": "737 MAX 8"},
    "A320NEO": {"manufacturer": "Airbus", "model": "A320neo"},
    "AIRBUS A-320": {"manufacturer": "Airbus", "model": "A320"},
    "AIRBUS A-319": {"manufacturer": "Airbus", "model": "A319"},
    "BOEING 737-800": {"manufacturer": "Boeing", "model": "737-800"},
    "BOEING 767-300": {"manufacturer": "Boeing", "model": "767-300"},
    "BOEING 787-9": {"manufacturer": "Boeing", "model": "787-9"},
    "CESSNA 172": {"manufacturer": "Cessna", "model": "172"},
}


def normalize_aircraft_type(aircraft_type):
    """ICAO type code or free-text description -> {"manufacturer", "model",
    "icao_type", "source", "confidence"} or None.
    """
    if not aircraft_type:
        return None
    key = aircraft_type.strip().upper()
    if not key:
        return None

    entry = TYPE_CODE_TABLE.get(key)
    if entry:
        return {
            "manufacturer": entry["manufacturer"], "model": entry["model"],
            "icao_type": key, "source": "aircraft_type_db", "confidence": 1.0,
        }

    entry = TYPE_DESC_TABLE.get(key)
    if entry:
        return {
            "manufacturer": entry["manufacturer"], "model": entry["model"],
            "icao_type": None, "source": "aircraft_type_db", "confidence": 1.0,
        }
    return None
