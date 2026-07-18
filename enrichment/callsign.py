"""ICAO 3-letter airline designator -> operator (+ that operator's home
country), decoded from the first 3 letters of a flight callsign.

Covers ~90 of the most important airlines globally — every major legacy
carrier, the dominant low-cost operators, plus regional Balkan/CWE airlines
relevant to this tracker's area. This is a hand-picked set, not a complete
ICAO Doc 8585 dump (~1500 active designators). The orchestrator's priority
chain means callsign decoding is the lowest-confidence tier for both operator
and country, so a miss here just means slower enrichment, not a broken map.
"""

from .countries import country_by_iso

AIRLINE_OPERATORS = {
    # ═══════════════ North America ═══════════════
    "AAL": {"operator": "American Airlines", "country_iso": "US"},
    "UAL": {"operator": "United Airlines", "country_iso": "US"},
    "DAL": {"operator": "Delta Air Lines", "country_iso": "US"},
    "SWA": {"operator": "Southwest Airlines", "country_iso": "US"},
    "JBU": {"operator": "JetBlue Airways", "country_iso": "US"},
    "NKS": {"operator": "Spirit Airlines", "country_iso": "US"},
    "ASA": {"operator": "Alaska Airlines", "country_iso": "US"},
    "FDX": {"operator": "FedEx Express", "country_iso": "US"},
    "UPS": {"operator": "UPS Airlines", "country_iso": "US"},
    "SKW": {"operator": "SkyWest Airlines", "country_iso": "US"},
    "RPA": {"operator": "Republic Airways", "country_iso": "US"},
    "ENY": {"operator": "Envoy Air", "country_iso": "US"},
    "QXE": {"operator": "Horizon Air", "country_iso": "US"},
    "ACA": {"operator": "Air Canada", "country_iso": "CA"},
    "WJA": {"operator": "WestJet", "country_iso": "CA"},
    "GTI": {"operator": "Atlas Air", "country_iso": "US"},
    "PAC": {"operator": "Polar Air Cargo", "country_iso": "US"},

    # ═══════════════ Europe ═══════════════
    "RYR": {"operator": "Ryanair", "country_iso": "IE"},
    "BAW": {"operator": "British Airways", "country_iso": "GB"},
    "AFR": {"operator": "Air France", "country_iso": "FR"},
    "DLH": {"operator": "Lufthansa", "country_iso": "DE"},
    "TVP": {"operator": "Smartwings", "country_iso": "CZ"},
    "KLM": {"operator": "KLM Royal Dutch Airlines", "country_iso": "NL"},
    "EZY": {"operator": "easyJet", "country_iso": "GB"},
    "WZZ": {"operator": "Wizz Air", "country_iso": "HU"},
    "THY": {"operator": "Turkish Airlines", "country_iso": "TR"},
    "AUA": {"operator": "Austrian Airlines", "country_iso": "AT"},
    "SWR": {"operator": "Swiss International Air Lines", "country_iso": "CH"},
    "LOT": {"operator": "LOT Polish Airlines", "country_iso": "PL"},
    "CSA": {"operator": "CSA Czech Airlines", "country_iso": "CZ"},
    "FIN": {"operator": "Finnair", "country_iso": "FI"},
    "SAS": {"operator": "SAS Scandinavian Airlines", "country_iso": "SE"},
    "IBE": {"operator": "Iberia", "country_iso": "ES"},
    "VLG": {"operator": "Vueling Airlines", "country_iso": "ES"},
    "NAX": {"operator": "Norwegian Air Shuttle", "country_iso": "NO"},
    "EXS": {"operator": "Jet2.com", "country_iso": "GB"},
    "TOM": {"operator": "TUI Airways", "country_iso": "GB"},
    "TRA": {"operator": "Transavia", "country_iso": "NL"},
    "BEL": {"operator": "Brussels Airlines", "country_iso": "BE"},
    "CLH": {"operator": "Lufthansa CityLine", "country_iso": "DE"},
    "EWG": {"operator": "Eurowings", "country_iso": "DE"},
    "BTI": {"operator": "Air Baltic", "country_iso": "LV"},
    "TVF": {"operator": "Transavia France", "country_iso": "FR"},
    "EZS": {"operator": "easyJet Switzerland", "country_iso": "CH"},
    "EJU": {"operator": "easyJet Europe", "country_iso": "AT"},
    "ITY": {"operator": "ITA Airways", "country_iso": "IT"},
    "RUK": {"operator": "Ryanair UK", "country_iso": "GB"},
    "ICE": {"operator": "Icelandair", "country_iso": "IS"},

    # ═══════════════ Balkans / CWE region ═══════════════
    "ASL": {"operator": "Air Serbia", "country_iso": "RS"},
    "CTN": {"operator": "Croatia Airlines", "country_iso": "HR"},
    "ROT": {"operator": "Tarom", "country_iso": "RO"},
    "ELY": {"operator": "El Al Israel Airlines", "country_iso": "IL"},
    "TAR": {"operator": "Tunisair", "country_iso": "TN"},
    "AEE": {"operator": "Aegean Airlines", "country_iso": "GR"},
    "SEH": {"operator": "Sky Express", "country_iso": "GR"},

    # ═══════════════ Middle East ═══════════════
    "UAE": {"operator": "Emirates", "country_iso": "AE"},
    "ETD": {"operator": "Etihad Airways", "country_iso": "AE"},
    "QTR": {"operator": "Qatar Airways", "country_iso": "QA"},
    "FDB": {"operator": "Flydubai", "country_iso": "AE"},
    "GFA": {"operator": "Gulf Air", "country_iso": "BH"},
    "ABY": {"operator": "Air Arabia", "country_iso": "AE"},

    # ═══════════════ Asia ═══════════════
    "CPA": {"operator": "Cathay Pacific", "country_iso": "HK"},
    "SIA": {"operator": "Singapore Airlines", "country_iso": "SG"},
    "CSN": {"operator": "China Southern Airlines", "country_iso": "CN"},
    "CES": {"operator": "China Eastern Airlines", "country_iso": "CN"},
    "CCA": {"operator": "Air China", "country_iso": "CN"},
    "CHH": {"operator": "Hainan Airlines", "country_iso": "CN"},
    "JAL": {"operator": "Japan Airlines", "country_iso": "JP"},
    "ANA": {"operator": "All Nippon Airways", "country_iso": "JP"},
    "KAL": {"operator": "Korean Air", "country_iso": "KR"},
    "AAR": {"operator": "Asiana Airlines", "country_iso": "KR"},
    "THA": {"operator": "Thai Airways", "country_iso": "TH"},
    "MAS": {"operator": "Malaysia Airlines", "country_iso": "MY"},
    "GIA": {"operator": "Garuda Indonesia", "country_iso": "ID"},
    "PAL": {"operator": "Philippine Airlines", "country_iso": "PH"},
    "VNA": {"operator": "Vietnam Airlines", "country_iso": "VN"},
    "VJC": {"operator": "VietJet Air", "country_iso": "VN"},
    "JJA": {"operator": "Jeju Air", "country_iso": "KR"},
    "AIQ": {"operator": "Thai AirAsia", "country_iso": "TH"},

    # ═══════════════ Oceania ═══════════════
    "QFA": {"operator": "Qantas Airways", "country_iso": "AU"},
    "VOZ": {"operator": "Virgin Australia", "country_iso": "AU"},
    "JST": {"operator": "Jetstar Airways", "country_iso": "AU"},
    "ANZ": {"operator": "Air New Zealand", "country_iso": "NZ"},

    # ═══════════════ Africa ═══════════════
    "ETH": {"operator": "Ethiopian Airlines", "country_iso": "ET"},
    "KQA": {"operator": "Kenya Airways", "country_iso": "KE"},
    "MSR": {"operator": "EgyptAir", "country_iso": "EG"},
    "RAM": {"operator": "Royal Air Maroc", "country_iso": "MA"},
    "MEA": {"operator": "Middle East Airlines", "country_iso": "LB"},
    "SAA": {"operator": "South African Airways", "country_iso": "ZA"},

    # ═══════════════ Eurasia / special ═══════════════
    "KZR": {"operator": "Air Astana", "country_iso": "KZ"},
    "LDA": {"operator": "Lauda Europe", "country_iso": "MT"},
    "AFL": {"operator": "Aeroflot", "country_iso": "RU"},
}

# Two independently-confidenced facts from one lookup: an operator name and
# that operator's home country. Kept separate (not two calls into two
# tables) since they come from the same designator and the orchestrator
# needs both, at different confidences, for two different priority chains.
OPERATOR_CONFIDENCE = 0.8
COUNTRY_CONFIDENCE = 0.6


def decode_callsign(callsign):
    """Callsign string -> {"operator", "source", "confidence", "country",
    "country_iso", "country_confidence"} or None.

    "country"/"country_iso"/"country_confidence" are only present when the
    designator's home country is in countries.py.
    """
    if not callsign:
        return None
    code = callsign.strip().upper()[:3]
    entry = AIRLINE_OPERATORS.get(code)
    if not entry:
        return None

    result = {
        "operator": entry["operator"],
        "source": "callsign_decode",
        "confidence": OPERATOR_CONFIDENCE,
    }
    country = country_by_iso(entry.get("country_iso"))
    if country:
        result["country"] = country["name"]
        result["country_iso"] = country["iso"]
        result["country_confidence"] = COUNTRY_CONFIDENCE
    return result