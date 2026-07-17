"""Registration (tail number) prefix -> country, via ICAO/ITU nationality
marks — a real, stable, well-known convention (not a placeholder guess).
"""

from .countries import country_by_iso

# Longest-prefix-match: try the 2-char prefix before falling back to 1-char,
# since marks vary between 1 and 2 letters/digits (e.g. "OK" for Czech
# Republic vs "N" for the United States).
PREFIX_TO_ISO = {
    "N": "US",
    "G": "GB",
    "D": "DE",
    "F": "FR",
    "I": "IT",
    "OK": "CZ",
    "YU": "RS",
    "EI": "IE",
    "PH": "NL",
    "SP": "PL",
    "HA": "HU",
    "OE": "AT",
    "HB": "CH",
    "EC": "ES",
    "9A": "HR",
    "YR": "RO",
    "LZ": "BG",
    "SX": "GR",
    "TC": "TR",
    "OO": "BE",
}


def lookup_country_by_registration(registration):
    """Registration string -> {"country", "country_iso", "source",
    "confidence"} or None.

    Handles both dash-separated marks ("OK-SWC" -> prefix "OK") and
    undelimited ones ("N123AB" -> prefix "N", tried 2-char then 1-char).
    """
    if not registration:
        return None
    reg = registration.strip().upper()
    if not reg:
        return None

    if "-" in reg:
        candidates = [reg.split("-", 1)[0]]
    else:
        candidates = [reg[:2], reg[:1]]

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
