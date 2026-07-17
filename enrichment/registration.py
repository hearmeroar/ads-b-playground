"""Registration (tail number) prefix -> country, via ICAO/ITU nationality
marks — a real, stable, standardized convention (ICAO Annex 7), not a
placeholder guess. Aims to cover essentially every ICAO member state's
mark, not just a hand-picked subset.
"""

from .countries import country_by_iso

# Nationality marks are 1-3 characters. Two ICAO territories share their
# sovereign's base mark but get their own sub-block after the dash — Hong
# Kong ("B-H...") and Macau ("B-M...") both fall under China's "B" —
# handled by also trying "prefix + first char after the dash" as a more
# specific candidate before falling back to the bare prefix (see
# lookup_country_by_registration).
PREFIX_TO_ISO = {
    # Composite marks (checked before their parent's bare prefix)
    "BH": "HK", "BM": "MO",
    # Everything else, alphabetical by mark
    "5A": "LY", "5B": "CY", "5H": "TZ", "5N": "NG", "5R": "MG", "5T": "MR",
    "5U": "NE", "5V": "TG", "5W": "WS", "5X": "UG", "5Y": "KE",
    "6O": "SO", "6V": "SN", "6W": "SN", "6Y": "JM",
    "7O": "YE", "7P": "LS", "7Q": "MW", "7T": "DZ",
    "8P": "BB", "8Q": "MV", "8R": "GY",
    "9A": "HR", "9G": "GH", "9H": "MT", "9J": "ZM", "9K": "KW", "9L": "SL",
    "9M": "MY", "9N": "NP", "9Q": "CD", "9U": "BI", "9V": "SG", "9XR": "RW",
    "9Y": "TT",
    "A2": "BW", "A3": "TO", "A40": "OM", "A5": "BT", "A6": "AE", "A7": "QA",
    "A9C": "BH",
    "AP": "PK",
    "B": "CN",
    "C": "CA", "C2": "NR", "C3": "AD", "C5": "GM", "C6": "BS", "C9": "MZ",
    "CC": "CL", "CN": "MA", "CP": "BO", "CS": "PT", "CU": "CU", "CX": "UY",
    "D": "DE", "D2": "AO", "D4": "CV", "D6": "KM",
    "DQ": "FJ",
    "E3": "ER", "E7": "BA",
    "EC": "ES", "EI": "IE", "EJ": "IE", "EK": "AM", "EL": "LR", "EP": "IR",
    "ER": "MD", "ES": "EE", "ET": "ET", "EW": "BY", "EX": "KG", "EY": "TJ",
    "EZ": "TM",
    "F": "FR",
    "G": "GB",
    "H4": "SB", "HA": "HU", "HB": "CH", "HC": "EC", "HH": "HT", "HI": "DO",
    "HK": "CO", "HL": "KR", "HP": "PA", "HR": "HN", "HS": "TH", "HZ": "SA",
    "I": "IT",
    "J2": "DJ", "J3": "GD", "J5": "GW", "J6": "LC", "J7": "DM", "J8": "VC",
    "JA": "JP", "JO": "JO", "JU": "MN", "JY": "JO",
    "LA": "LA", "LN": "NO", "LV": "AR", "LX": "LU", "LY": "LT", "LZ": "BG",
    "N": "US",
    "OB": "PE", "OD": "LB", "OE": "AT", "OH": "FI", "OK": "CZ", "OM": "SK",
    "OO": "BE", "OY": "DK",
    "P2": "PG", "P4": "AW", "P5": "KP",
    "PH": "NL", "PK": "ID", "PP": "BR", "PR": "BR", "PT": "BR", "PU": "BR",
    "PZ": "SR",
    "RA": "RU", "RDPL": "LA", "RP": "PH",
    "S2": "BD", "S5": "SI", "S7": "SC", "S9": "ST", "SE": "SE", "SP": "PL",
    "ST": "SD", "SU": "EG", "SX": "GR",
    "T2": "TV", "T3": "KI", "T7": "SM", "T8A": "PW", "TC": "TR", "TF": "IS",
    "TG": "GT", "TI": "CR", "TJ": "CM", "TL": "CF", "TN": "CG", "TR": "GA",
    "TS": "TN", "TT": "TD", "TU": "CI", "TY": "BJ", "TZ": "ML",
    "UK": "UZ", "UP": "KZ", "UR": "UA",
    "V2": "AG", "V3": "BZ", "V4": "KN", "V5": "NA", "V6": "FM", "V7": "MH",
    "V8": "BN", "VH": "AU", "VN": "VN", "VT": "IN",
    "XA": "MX", "XB": "MX", "XC": "MX", "XT": "BF", "XU": "KH", "XY": "MM",
    "YA": "AF", "YI": "IQ", "YJ": "VU", "YK": "SY", "YL": "LV", "YN": "NI",
    "YR": "RO", "YS": "SV", "YU": "RS", "YV": "VE",
    "Z": "ZW", "Z3": "MK", "ZA": "AL", "ZK": "NZ", "ZP": "PY", "ZS": "ZA",
}


def lookup_country_by_registration(registration):
    """Registration string -> {"country", "country_iso", "source",
    "confidence"} or None.

    Handles dash-separated marks ("OK-SWC" -> prefix "OK", "B-HAA" -> tries
    the more specific "BH" before falling back to "B") and undelimited ones
    ("N123AB" -> prefix "N", tried 3-char then 2-char then 1-char).
    """
    if not registration:
        return None
    reg = registration.strip().upper()
    if not reg:
        return None

    candidates = []
    if "-" in reg:
        before, _, after = reg.partition("-")
        if after:
            candidates.append(before + after[0])
        candidates.append(before)
    else:
        candidates.extend([reg[:3], reg[:2], reg[:1]])

    for prefix in candidates:
        iso = PREFIX_TO_ISO.get(prefix)
        if iso:
            country = country_by_iso(iso)
            if country:
                return {
                    "country": country["name"],
                    "country_iso": country["iso"],
                    "source": "registration_prefix",
                    "confidence": 1.0,
                }
    return None
