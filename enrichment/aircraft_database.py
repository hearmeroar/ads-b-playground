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

    # -- Airbus --
    "A318": {"manufacturer": "Airbus", "model": "A318"},
    "A19N": {"manufacturer": "Airbus", "model": "A319neo"},
    "A321": {"manufacturer": "Airbus", "model": "A321"},
    "A332": {"manufacturer": "Airbus", "model": "A330-200"},
    "A333": {"manufacturer": "Airbus", "model": "A330-300"},
    "A339": {"manufacturer": "Airbus", "model": "A330-900neo"},
    "A342": {"manufacturer": "Airbus", "model": "A340-200"},
    "A343": {"manufacturer": "Airbus", "model": "A340-300"},
    "A345": {"manufacturer": "Airbus", "model": "A340-500"},
    "A346": {"manufacturer": "Airbus", "model": "A340-600"},
    "A359": {"manufacturer": "Airbus", "model": "A350-900"},
    "A35K": {"manufacturer": "Airbus", "model": "A350-1000"},
    "A388": {"manufacturer": "Airbus", "model": "A380-800"},

    # -- Boeing --
    "B734": {"manufacturer": "Boeing", "model": "737-400"},
    "B735": {"manufacturer": "Boeing", "model": "737-500"},
    "B736": {"manufacturer": "Boeing", "model": "737-600"},
    "B737": {"manufacturer": "Boeing", "model": "737-700"},
    "B39M": {"manufacturer": "Boeing", "model": "737 MAX 9"},
    "B3XM": {"manufacturer": "Boeing", "model": "737 MAX 10"},
    "B741": {"manufacturer": "Boeing", "model": "747-100"},
    "B742": {"manufacturer": "Boeing", "model": "747-200"},
    "B743": {"manufacturer": "Boeing", "model": "747-300"},
    "B744": {"manufacturer": "Boeing", "model": "747-400"},
    "B748": {"manufacturer": "Boeing", "model": "747-8"},
    "B752": {"manufacturer": "Boeing", "model": "757-200"},
    "B753": {"manufacturer": "Boeing", "model": "757-300"},
    "B762": {"manufacturer": "Boeing", "model": "767-200"},
    "B764": {"manufacturer": "Boeing", "model": "767-400"},
    "B772": {"manufacturer": "Boeing", "model": "777-200"},
    "B773": {"manufacturer": "Boeing", "model": "777-300"},
    "B77L": {"manufacturer": "Boeing", "model": "777-200LR"},
    "B77W": {"manufacturer": "Boeing", "model": "777-300ER"},
    "B78X": {"manufacturer": "Boeing", "model": "787-10"},

    # -- Regional jets --
    "CRJ2": {"manufacturer": "Bombardier", "model": "CRJ200"},
    "CRJ7": {"manufacturer": "Bombardier", "model": "CRJ700"},
    "CRJ9": {"manufacturer": "Bombardier", "model": "CRJ900"},
    "CRJX": {"manufacturer": "Bombardier", "model": "CRJ1000"},
    "E170": {"manufacturer": "Embraer", "model": "E170"},
    "E75L": {"manufacturer": "Embraer", "model": "E175 (long wing)"},
    "E75S": {"manufacturer": "Embraer", "model": "E175 (short wing)"},
    "E190": {"manufacturer": "Embraer", "model": "E190"},
    "E195": {"manufacturer": "Embraer", "model": "E195"},
    "E275": {"manufacturer": "Embraer", "model": "E175-E2"},
    "E290": {"manufacturer": "Embraer", "model": "E190-E2"},
    "E295": {"manufacturer": "Embraer", "model": "E195-E2"},
    "F70": {"manufacturer": "Fokker", "model": "F70"},
    "F100": {"manufacturer": "Fokker", "model": "F100"},

    # -- Turboprops --
    "AT43": {"manufacturer": "ATR", "model": "ATR 42-300"},
    "AT45": {"manufacturer": "ATR", "model": "ATR 42-500"},
    "AT72": {"manufacturer": "ATR", "model": "ATR 72"},
    "AT76": {"manufacturer": "ATR", "model": "ATR 72-600"},
    "DH8A": {"manufacturer": "De Havilland Canada", "model": "Dash 8-100"},
    "DH8B": {"manufacturer": "Bombardier", "model": "Dash 8-200"},
    "DH8C": {"manufacturer": "Bombardier", "model": "Dash 8-300"},
    "DH8D": {"manufacturer": "Bombardier", "model": "Dash 8 Q400"},
    "SF34": {"manufacturer": "Saab", "model": "340"},
    "B190": {"manufacturer": "Beechcraft", "model": "1900"},

    # -- Business jets --
    "GLF4": {"manufacturer": "Gulfstream", "model": "G450"},
    "GLF5": {"manufacturer": "Gulfstream", "model": "G550"},
    "GLF6": {"manufacturer": "Gulfstream", "model": "G650"},
    "CL30": {"manufacturer": "Bombardier", "model": "Challenger 300"},
    "CL35": {"manufacturer": "Bombardier", "model": "Challenger 350"},
    "CL60": {"manufacturer": "Bombardier", "model": "Challenger 600"},
    "GLEX": {"manufacturer": "Bombardier", "model": "Global Express"},
    "FA7X": {"manufacturer": "Dassault", "model": "Falcon 7X"},
    "F900": {"manufacturer": "Dassault", "model": "Falcon 900"},
    "C25A": {"manufacturer": "Cessna", "model": "Citation CJ2"},
    "C25B": {"manufacturer": "Cessna", "model": "Citation CJ3"},
    "C56X": {"manufacturer": "Cessna", "model": "Citation Excel"},
    "C68A": {"manufacturer": "Cessna", "model": "Citation Latitude"},
    "LJ45": {"manufacturer": "Learjet", "model": "Learjet 45"},
    "LJ60": {"manufacturer": "Learjet", "model": "Learjet 60"},
    "PC24": {"manufacturer": "Pilatus", "model": "PC-24"},
    "H25B": {"manufacturer": "Hawker Beechcraft", "model": "Hawker 800"},

    # -- Light GA --
    "C152": {"manufacturer": "Cessna", "model": "152"},
    "C182": {"manufacturer": "Cessna", "model": "182 Skylane"},
    "C206": {"manufacturer": "Cessna", "model": "206 Stationair"},
    "C210": {"manufacturer": "Cessna", "model": "210 Centurion"},
    "P28A": {"manufacturer": "Piper", "model": "PA-28 Cherokee"},
    "PA32": {"manufacturer": "Piper", "model": "PA-32 Saratoga"},
    "PA34": {"manufacturer": "Piper", "model": "PA-34 Seneca"},
    "PA44": {"manufacturer": "Piper", "model": "PA-44 Seminole"},
    "SR20": {"manufacturer": "Cirrus", "model": "SR20"},
    "SR22": {"manufacturer": "Cirrus", "model": "SR22"},
    "DA40": {"manufacturer": "Diamond Aircraft", "model": "DA40"},
    "DA42": {"manufacturer": "Diamond Aircraft", "model": "DA42 Twin Star"},
    "BE20": {"manufacturer": "Beechcraft", "model": "King Air 200"},
    "BE36": {"manufacturer": "Beechcraft", "model": "Bonanza 36"},
    "BE58": {"manufacturer": "Beechcraft", "model": "Baron 58"},
    "M20P": {"manufacturer": "Mooney", "model": "M20"},
    "TBM8": {"manufacturer": "Daher", "model": "TBM 850"},
    "TBM9": {"manufacturer": "Daher", "model": "TBM 900"},

    # -- Helicopters --
    "EC35": {"manufacturer": "Airbus Helicopters", "model": "H135"},
    "EC45": {"manufacturer": "Airbus Helicopters", "model": "H145"},
    "EC30": {"manufacturer": "Airbus Helicopters", "model": "H130"},
    "AS50": {"manufacturer": "Airbus Helicopters", "model": "AS350 Écureuil"},
    "AS65": {"manufacturer": "Airbus Helicopters", "model": "AS365 Dauphin"},
    "R44": {"manufacturer": "Robinson", "model": "R44"},
    "R66": {"manufacturer": "Robinson", "model": "R66"},
    "S76": {"manufacturer": "Sikorsky", "model": "S-76"},
    "S92": {"manufacturer": "Sikorsky", "model": "S-92"},
    "B06": {"manufacturer": "Bell", "model": "206"},
    "B412": {"manufacturer": "Bell", "model": "412"},
    "B429": {"manufacturer": "Bell", "model": "429"},
}

# Free-text descriptions as reported by adsb.fi/airplanes.live's "desc"
# field — normalized separately from the ICAO code table since the two
# vocabularies don't overlap key-for-key. Every key here is the exact,
# verified real-world string readsb (the engine behind adsb.fi/adsb.lol/
# airplanes.live) generates for that ICAO type code, sourced from
# wiedehopf/tar1090-db's own per-hex aircraft database (the actual table
# readsb uses to populate "desc") — not hand-guessed. An earlier hand-
# written version of this table used invented placeholder strings (e.g.
# "B737 MAX 8", "CESSNA 172") that never matched any real aircraft's
# actual desc text, silently failing this table's entire lookup path for
# real traffic; this replacement is generated 1:1 from TYPE_CODE_TABLE
# against that real per-hex database, one entry per code, using each
# code's single most common real desc variant (a handful of codes have a
# secondary desc for a distinct military variant, e.g. EC45's "UH-72A
# Lakota" — intentionally not included here, since that's a different
# specific aircraft, not a formatting variant of the civilian one above).
TYPE_DESC_TABLE = {
    "BOEING 737 MAX 8": {"manufacturer": "Boeing", "model": "737 MAX 8"},
    "AIRBUS A-320NEO": {"manufacturer": "Airbus", "model": "A320neo"},
    "AIRBUS A-321NEO": {"manufacturer": "Airbus", "model": "A321neo"},
    "BOEING 737-800": {"manufacturer": "Boeing", "model": "737-800"},
    "BOEING 737-900": {"manufacturer": "Boeing", "model": "737-900"},
    "AIRBUS A-320": {"manufacturer": "Airbus", "model": "A320"},
    "AIRBUS A-319": {"manufacturer": "Airbus", "model": "A319"},
    "BOEING 787-8 DREAMLINER": {"manufacturer": "Boeing", "model": "787-8"},
    "BOEING 787-9 DREAMLINER": {"manufacturer": "Boeing", "model": "787-9"},
    "BOEING 767-300": {"manufacturer": "Boeing", "model": "767-300"},
    "CESSNA 172 SKYHAWK": {"manufacturer": "Cessna", "model": "172"},
    "AIRBUS A-318": {"manufacturer": "Airbus", "model": "A318"},
    "AIRBUS A-319NEO": {"manufacturer": "Airbus", "model": "A319neo"},
    "AIRBUS A-321": {"manufacturer": "Airbus", "model": "A321"},
    "AIRBUS A-330-200": {"manufacturer": "Airbus", "model": "A330-200"},
    "AIRBUS A-330-300": {"manufacturer": "Airbus", "model": "A330-300"},
    "AIRBUS A-330-900": {"manufacturer": "Airbus", "model": "A330-900neo"},
    "AIRBUS A-340-200": {"manufacturer": "Airbus", "model": "A340-200"},
    "AIRBUS A-340-300": {"manufacturer": "Airbus", "model": "A340-300"},
    "AIRBUS A-340-500": {"manufacturer": "Airbus", "model": "A340-500"},
    "AIRBUS A-340-600": {"manufacturer": "Airbus", "model": "A340-600"},
    "AIRBUS A-350-900": {"manufacturer": "Airbus", "model": "A350-900"},
    "AIRBUS A-350-1000": {"manufacturer": "Airbus", "model": "A350-1000"},
    "AIRBUS A-380-800": {"manufacturer": "Airbus", "model": "A380-800"},
    "BOEING 737-400": {"manufacturer": "Boeing", "model": "737-400"},
    "BOEING 737-500": {"manufacturer": "Boeing", "model": "737-500"},
    "BOEING 737-600": {"manufacturer": "Boeing", "model": "737-600"},
    "BOEING 737-700": {"manufacturer": "Boeing", "model": "737-700"},
    "BOEING 737 MAX 9": {"manufacturer": "Boeing", "model": "737 MAX 9"},
    "BOEING 737 MAX 10": {"manufacturer": "Boeing", "model": "737 MAX 10"},
    "BOEING 747-100": {"manufacturer": "Boeing", "model": "747-100"},
    "BOEING 747-200": {"manufacturer": "Boeing", "model": "747-200"},
    "BOEING 747-300": {"manufacturer": "Boeing", "model": "747-300"},
    "BOEING 747-400": {"manufacturer": "Boeing", "model": "747-400"},
    "BOEING 747-8": {"manufacturer": "Boeing", "model": "747-8"},
    "BOEING 757-200": {"manufacturer": "Boeing", "model": "757-200"},
    "BOEING 757-300": {"manufacturer": "Boeing", "model": "757-300"},
    "BOEING 767-200": {"manufacturer": "Boeing", "model": "767-200"},
    "BOEING 767-400": {"manufacturer": "Boeing", "model": "767-400"},
    "BOEING 777-200": {"manufacturer": "Boeing", "model": "777-200"},
    "BOEING 777-300": {"manufacturer": "Boeing", "model": "777-300"},
    "BOEING 777-200LR": {"manufacturer": "Boeing", "model": "777-200LR"},
    "BOEING 777-300ER": {"manufacturer": "Boeing", "model": "777-300ER"},
    "BOEING 787-10 DREAMLINER": {"manufacturer": "Boeing", "model": "787-10"},
    "BOMBARDIER REGIONAL JET CRJ-200": {"manufacturer": "Bombardier", "model": "CRJ200"},
    "BOMBARDIER REGIONAL JET CRJ-700": {"manufacturer": "Bombardier", "model": "CRJ700"},
    "BOMBARDIER REGIONAL JET CRJ-900": {"manufacturer": "Bombardier", "model": "CRJ900"},
    "BOMBARDIER REGIONAL JET CRJ-1000": {"manufacturer": "Bombardier", "model": "CRJ1000"},
    "EMBRAER ERJ-170-100": {"manufacturer": "Embraer", "model": "E170"},
    "EMBRAER ERJ-170-200 (LONG WING)": {"manufacturer": "Embraer", "model": "E175 (long wing)"},
    "EMBRAER ERJ-170-200 (SHORT WING)": {"manufacturer": "Embraer", "model": "E175 (short wing)"},
    "EMBRAER ERJ-190-100": {"manufacturer": "Embraer", "model": "E190"},
    "EMBRAER ERJ-190-200": {"manufacturer": "Embraer", "model": "E195"},
    "EMBRAER ERJ-190-500": {"manufacturer": "Embraer", "model": "E175-E2"},
    "EMBRAER ERJ-190-300": {"manufacturer": "Embraer", "model": "E190-E2"},
    "EMBRAER ERJ-190-400": {"manufacturer": "Embraer", "model": "E195-E2"},
    "FOKKER 70": {"manufacturer": "Fokker", "model": "F70"},
    "FOKKER 100": {"manufacturer": "Fokker", "model": "F100"},
    "ATR-42-300": {"manufacturer": "ATR", "model": "ATR 42-300"},
    "ATR-42-500": {"manufacturer": "ATR", "model": "ATR 42-500"},
    "ATR-72-202": {"manufacturer": "ATR", "model": "ATR 72"},
    "ATR-72-600": {"manufacturer": "ATR", "model": "ATR 72-600"},
    "DE HAVILLAND DHC-8-100 DASH 8": {"manufacturer": "De Havilland Canada", "model": "Dash 8-100"},
    "DE HAVILLAND DHC-8-200 DASH 8": {"manufacturer": "Bombardier", "model": "Dash 8-200"},
    "DE HAVILLAND DHC-8-300 DASH 8": {"manufacturer": "Bombardier", "model": "Dash 8-300"},
    "DE HAVILLAND DHC-8-400 DASH 8": {"manufacturer": "Bombardier", "model": "Dash 8 Q400"},
    "SAAB 340": {"manufacturer": "Saab", "model": "340"},
    "BEECH 1900": {"manufacturer": "Beechcraft", "model": "1900"},
    "GULFSTREAM 4": {"manufacturer": "Gulfstream", "model": "G450"},
    "GULFSTREAM 5": {"manufacturer": "Gulfstream", "model": "G550"},
    "GULFSTREAM G650": {"manufacturer": "Gulfstream", "model": "G650"},
    "BOMBARDIER BD-100 CHALLENGER 300": {"manufacturer": "Bombardier", "model": "Challenger 300"},
    "BOMBARDIER BD-100 CHALLENGER 350": {"manufacturer": "Bombardier", "model": "Challenger 350"},
    "BOMBARDIER CL-600 CHALLENGER": {"manufacturer": "Bombardier", "model": "Challenger 600"},
    "BOMBARDIER BD-700 GLOBAL 6000/6500": {"manufacturer": "Bombardier", "model": "Global Express"},
    "DASSAULT FALCON 7X": {"manufacturer": "Dassault", "model": "Falcon 7X"},
    "DASSAULT FALCON 900": {"manufacturer": "Dassault", "model": "Falcon 900"},
    "CESSNA 525A CITATION CJ2": {"manufacturer": "Cessna", "model": "Citation CJ2"},
    "CESSNA 525B CITATION CJ3": {"manufacturer": "Cessna", "model": "Citation CJ3"},
    "CESSNA 560XL CITATION XLS": {"manufacturer": "Cessna", "model": "Citation Excel"},
    "CESSNA 680 CITATION LATITUDE": {"manufacturer": "Cessna", "model": "Citation Latitude"},
    "LEARJET 45": {"manufacturer": "Learjet", "model": "Learjet 45"},
    "LEARJET 60": {"manufacturer": "Learjet", "model": "Learjet 60"},
    "PILATUS PC-24": {"manufacturer": "Pilatus", "model": "PC-24"},
    "HAWKER BEECHCRAFT HAWKER 750/850": {"manufacturer": "Hawker Beechcraft", "model": "Hawker 800"},
    "CESSNA 152": {"manufacturer": "Cessna", "model": "152"},
    "CESSNA 182 SKYLANE": {"manufacturer": "Cessna", "model": "182 Skylane"},
    "CESSNA  206 STATIONAIR": {"manufacturer": "Cessna", "model": "206 Stationair"},
    "CESSNA 201 CENTURION": {"manufacturer": "Cessna", "model": "210 Centurion"},
    "PIPER PA-28-140/150/160/180": {"manufacturer": "Piper", "model": "PA-28 Cherokee"},
    "PIPER PA-32": {"manufacturer": "Piper", "model": "PA-32 Saratoga"},
    "PIPER PA-34 SENECA": {"manufacturer": "Piper", "model": "PA-34 Seneca"},
    "PIPER PA-44 SEMINOLE": {"manufacturer": "Piper", "model": "PA-44 Seminole"},
    "CIRRUS SR-20": {"manufacturer": "Cirrus", "model": "SR20"},
    "CIRRUS SR-22": {"manufacturer": "Cirrus", "model": "SR22"},
    "DIAMOND DA-40 CLUB STAR": {"manufacturer": "Diamond Aircraft", "model": "DA40"},
    "DIAMOND DA-42 GUARDIAN": {"manufacturer": "Diamond Aircraft", "model": "DA42 Twin Star"},
    "BEECH 200 SUPER KING AIR": {"manufacturer": "Beechcraft", "model": "King Air 200"},
    "BEECH 36 BONANZA": {"manufacturer": "Beechcraft", "model": "Bonanza 36"},
    "BEECH 58 BARON": {"manufacturer": "Beechcraft", "model": "Baron 58"},
    "MOONEY M-20": {"manufacturer": "Mooney", "model": "M20"},
    "SOCATA TBM-850": {"manufacturer": "Daher", "model": "TBM 850"},
    "SOCATA TBM-900/910/930/940": {"manufacturer": "Daher", "model": "TBM 900"},
    "AIRBUS HELICOPTERS EC-135/635": {"manufacturer": "Airbus Helicopters", "model": "H135"},
    "AIRBUS HELICOPTERS EC-145": {"manufacturer": "Airbus Helicopters", "model": "H145"},
    "AIRBUS HELICOPTERS EC-130": {"manufacturer": "Airbus Helicopters", "model": "H130"},
    "AEROSPATIALE AS-350 ECUREUIL": {"manufacturer": "Airbus Helicopters", "model": "AS350 Écureuil"},
    "AEROSPATIALE AS-365 DAUPHIN 2": {"manufacturer": "Airbus Helicopters", "model": "AS365 Dauphin"},
    "ROBINSON R-44 RAVEN": {"manufacturer": "Robinson", "model": "R44"},
    "ROBINSON R-66": {"manufacturer": "Robinson", "model": "R66"},
    "SIKORSKY S-76 SPIRIT": {"manufacturer": "Sikorsky", "model": "S-76"},
    "SIKORSKY S-92 HELIBUS": {"manufacturer": "Sikorsky", "model": "S-92"},
    "BELL 206 JETRANGER": {"manufacturer": "Bell", "model": "206"},
    "BELL 412": {"manufacturer": "Bell", "model": "412"},
    "BELL 429 GLOBALRANGER": {"manufacturer": "Bell", "model": "429"},
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
