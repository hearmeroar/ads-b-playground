"""Static manufacturer+model -> ADS-B (DO-260B) emitter category fallback.

The lowest-priority tier in the category chain: OpenSky's own numeric
category and adsb.fi/airplanes.live's letter+digit code (see
`OPENSKY_CATEGORY_GROUP`/`ADSBEXCHANGE_CATEGORY_GROUP`,
`static/js/state-filters.js`) always win when the live feed actually
reports one — this table is only ever consulted once manufacturer and
model are already known (from `aircraft_database.py`'s own
`TYPE_CODE_TABLE`/`TYPE_DESC_TABLE`/`_PLACEHOLDER_RECORDS` tiers) and the
live feed reported no category at all (category 0/1 on OpenSky, or a
missing/"A0" code on the radius sources).

Every code here is looked up from the aircraft type's real, publicly
published maximum takeoff weight (MTOW) against the fixed DO-260B/FAA
weight thresholds, not guessed:
  A1 Light            < 15,500 lb   (~7,031 kg)
  A2 Small            15,500 - 75,000 lb
  A3 Large            75,000 - 300,000 lb
  A4 High vortex large  a large aircraft specifically designated for its
                         unusually strong wake vortex — the Boeing 757 is
                         the standard textbook example and the only type
                         in this table's coverage that qualifies
  A5 Heavy            > 300,000 lb
  A7 Rotorcraft       any helicopter, regardless of weight (DO-260B assigns
                       A7 to all rotorcraft unconditionally — it is not a
                       weight class)
No A6 (high performance, >5g/>400kt — military/aerobatic), B-series
(glider/lighter-than-air/parachutist/ultralight/UAV) or C-series (ground
vehicle/obstacle) entries exist here, since `TYPE_CODE_TABLE` — the only
vocabulary this table is keyed against — has no aircraft of those kinds to
map; nothing here is invented to fill that gap.

One entry per `TYPE_CODE_TABLE` (manufacturer, model) pair (verified 1:1 —
see `test_aircraft_category.py`), each checked against the type's own
published MTOW figure (manufacturer spec sheets / type-certificate data
sheets, cross-referenced via Wikipedia's aggregation where the primary
document wasn't directly accessible) rather than assumed from the aircraft's
general size class — several boundary cases only became clear this way,
e.g. the Airbus A320 and Boeing 737 families are both well past the 75,000 lb
Large threshold (~170,000+ lb) despite "narrow-body single-aisle" sounding
like it should mean Small, while the Gulfstream G450 (74,600 lb) and
Embraer E170 (~80,000+ lb) sit right on opposite sides of that same
threshold from what their business-jet/regional-jet category might suggest.
A given real-world tail number's actual certified MTOW can vary slightly by
sub-variant/operator configuration in ways this table (one representative
figure per named model) can't capture — which is why the orchestrator gives
this tier a confidence below 1.0, unlike the exact-match `aircraft_type_db`
tier it depends on.
"""


def _norm(value):
    return (value or "").strip().upper()


# fmt: off
_CATEGORY_TABLE = {
    # -- Rotorcraft (A7) -- DO-260B assigns A7 to every helicopter
    # unconditionally, regardless of weight.
    ("Airbus Helicopters", "H135"): "A7",
    ("Airbus Helicopters", "H145"): "A7",
    ("Airbus Helicopters", "H130"): "A7",
    ("Airbus Helicopters", "AS350 Écureuil"): "A7",
    ("Airbus Helicopters", "AS365 Dauphin"): "A7",
    ("Robinson", "R44"): "A7",
    ("Robinson", "R66"): "A7",
    ("Sikorsky", "S-76"): "A7",
    ("Sikorsky", "S-92"): "A7",
    ("Bell", "206"): "A7",
    ("Bell", "412"): "A7",
    ("Bell", "429"): "A7",

    # -- Light (A1, MTOW < 15,500 lb) -- light GA singles/twins and the two
    # lightest business jets in the table (Citation CJ2 12,375 lb, CJ3
    # 13,870 lb) and the King Air 200 (12,500 lb).
    ("Cessna", "172"): "A1",
    ("Cessna", "152"): "A1",
    ("Cessna", "182 Skylane"): "A1",
    ("Cessna", "206 Stationair"): "A1",
    ("Cessna", "210 Centurion"): "A1",
    ("Cessna", "Citation CJ2"): "A1",
    ("Cessna", "Citation CJ3"): "A1",
    ("Piper", "PA-28 Cherokee"): "A1",
    ("Piper", "PA-32 Saratoga"): "A1",
    ("Piper", "PA-34 Seneca"): "A1",
    ("Piper", "PA-44 Seminole"): "A1",
    ("Cirrus", "SR20"): "A1",
    ("Cirrus", "SR22"): "A1",
    ("Diamond Aircraft", "DA40"): "A1",
    ("Diamond Aircraft", "DA42 Twin Star"): "A1",
    ("Beechcraft", "King Air 200"): "A1",
    ("Beechcraft", "Bonanza 36"): "A1",
    ("Beechcraft", "Baron 58"): "A1",
    ("Mooney", "M20"): "A1",
    ("Daher", "TBM 850"): "A1",
    ("Daher", "TBM 900"): "A1",

    # -- Small (A2, 15,500-75,000 lb) -- regional turboprops, the two
    # smallest regional jets (CRJ200 53,000 lb, CRJ700 72,750 lb), and every
    # business jet in the table except the two lightest (above) and the
    # three heaviest (Global Express, G550, G650 — below, all past 75,000 lb).
    ("Beechcraft", "1900"): "A2",
    ("Saab", "340"): "A2",
    ("ATR", "ATR 42-300"): "A2",
    ("ATR", "ATR 42-500"): "A2",
    ("ATR", "ATR 72"): "A2",
    ("ATR", "ATR 72-600"): "A2",
    ("De Havilland Canada", "Dash 8-100"): "A2",
    ("Bombardier", "Dash 8-200"): "A2",
    ("Bombardier", "Dash 8-300"): "A2",
    ("Bombardier", "Dash 8 Q400"): "A2",
    ("Bombardier", "CRJ200"): "A2",
    ("Bombardier", "CRJ700"): "A2",
    ("Bombardier", "Challenger 300"): "A2",
    ("Bombardier", "Challenger 350"): "A2",
    ("Bombardier", "Challenger 600"): "A2",
    ("Dassault", "Falcon 7X"): "A2",
    ("Dassault", "Falcon 900"): "A2",
    ("Learjet", "Learjet 45"): "A2",
    ("Learjet", "Learjet 60"): "A2",
    ("Pilatus", "PC-24"): "A2",
    ("Hawker Beechcraft", "Hawker 800"): "A2",
    ("Cessna", "Citation Excel"): "A2",
    ("Cessna", "Citation Latitude"): "A2",
    ("Gulfstream", "G450"): "A2",

    # -- Large (A3, 75,000-300,000 lb) -- every Airbus A320-family and
    # Boeing 737-family variant (~150,000-220,000 lb, well past the 75,000
    # lb threshold despite being "narrow-body"), the two largest regional
    # jets (CRJ900/CRJ1000) and the whole Embraer E-Jet/E-Jet E2 family
    # (all >75,000 lb, unlike the smaller CRJ200/700), both Fokker types,
    # the two heaviest Gulfstreams, and the Global Express.
    ("Airbus", "A320neo"): "A3",
    ("Airbus", "A321neo"): "A3",
    ("Airbus", "A320"): "A3",
    ("Airbus", "A319"): "A3",
    ("Airbus", "A318"): "A3",
    ("Airbus", "A319neo"): "A3",
    ("Airbus", "A321"): "A3",
    ("Boeing", "737 MAX 8"): "A3",
    ("Boeing", "737-800"): "A3",
    ("Boeing", "737-900"): "A3",
    ("Boeing", "737-400"): "A3",
    ("Boeing", "737-500"): "A3",
    ("Boeing", "737-600"): "A3",
    ("Boeing", "737-700"): "A3",
    ("Boeing", "737 MAX 9"): "A3",
    ("Boeing", "737 MAX 10"): "A3",
    ("Bombardier", "CRJ900"): "A3",
    ("Bombardier", "CRJ1000"): "A3",
    ("Bombardier", "Global Express"): "A3",
    ("Embraer", "E170"): "A3",
    ("Embraer", "E175 (long wing)"): "A3",
    ("Embraer", "E175 (short wing)"): "A3",
    ("Embraer", "E190"): "A3",
    ("Embraer", "E195"): "A3",
    ("Embraer", "E175-E2"): "A3",
    ("Embraer", "E190-E2"): "A3",
    ("Embraer", "E195-E2"): "A3",
    ("Fokker", "F70"): "A3",
    ("Fokker", "F100"): "A3",
    ("Gulfstream", "G550"): "A3",
    ("Gulfstream", "G650"): "A3",

    # -- High vortex large (A4) -- the Boeing 757, the canonical example
    # DO-260B/FAA guidance itself names for this category.
    ("Boeing", "757-200"): "A4",
    ("Boeing", "757-300"): "A4",

    # -- Heavy (A5, MTOW > 300,000 lb) -- every wide-body in the table.
    ("Boeing", "787-8"): "A5",
    ("Boeing", "787-9"): "A5",
    ("Boeing", "787-10"): "A5",
    ("Boeing", "767-300"): "A5",
    ("Boeing", "767-200"): "A5",
    ("Boeing", "767-400"): "A5",
    ("Boeing", "747-100"): "A5",
    ("Boeing", "747-200"): "A5",
    ("Boeing", "747-300"): "A5",
    ("Boeing", "747-400"): "A5",
    ("Boeing", "747-8"): "A5",
    ("Boeing", "777-200"): "A5",
    ("Boeing", "777-300"): "A5",
    ("Boeing", "777-200LR"): "A5",
    ("Boeing", "777-300ER"): "A5",
    ("Airbus", "A330-200"): "A5",
    ("Airbus", "A330-300"): "A5",
    ("Airbus", "A330-900neo"): "A5",
    ("Airbus", "A340-200"): "A5",
    ("Airbus", "A340-300"): "A5",
    ("Airbus", "A340-500"): "A5",
    ("Airbus", "A340-600"): "A5",
    ("Airbus", "A350-900"): "A5",
    ("Airbus", "A350-1000"): "A5",
    ("Airbus", "A380-800"): "A5",
}
# fmt: on

_NORMALIZED_CATEGORY_TABLE = {
    (_norm(manufacturer), _norm(model)): code
    for (manufacturer, model), code in _CATEGORY_TABLE.items()
}


def category_for_aircraft(manufacturer, model):
    """(manufacturer, model) -> ADS-B emitter category code ("A1".."A7") or
    None. Case/whitespace-insensitive so it matches regardless of which
    tier resolved manufacturer/model.
    """
    if not manufacturer or not model:
        return None
    return _NORMALIZED_CATEGORY_TABLE.get((_norm(manufacturer), _norm(model)))
