#!/usr/bin/env python3
# update_capitals.py
# Bygger server/capitals.json (alla huvudstäder som finns i ditt cities.js)
# Robust mot quotes i stadsnamn som N"Djamena.

import json
import re
from pathlib import Path

CITIES_JS = "cities.js"
COUNTRYINFO_TXT = "countryInfo.txt"          # GeoNames
OUT_CAPITALS_JSON = "capitals.json"
OUT_MISSING_JSON = "capitals_missing_in_cities.json"


def strip_js_comments(s: str) -> str:
    s = re.sub(r"/\*[\s\S]*?\*/", "", s)
    s = re.sub(r"//.*?$", "", s, flags=re.MULTILINE)
    return s


def find_cities_array_text(js_text: str) -> str:
    m = re.search(r"\bcities\s*=\s*\[", js_text)
    if not m:
        m = re.search(r"export\s+const\s+cities\s*=\s*\[", js_text)
    if not m:
        raise RuntimeError("Kunde inte hitta 'cities = [' i cities.js")

    start = js_text.find("[", m.start())
    if start < 0:
        raise RuntimeError("Hittade inte '[' efter cities =")

    depth = 0
    in_str = None
    esc = False
    for i in range(start, len(js_text)):
        ch = js_text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
            continue
        else:
            if ch in ("'", '"'):
                in_str = ch
                continue
            if ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    return js_text[start : i + 1]

    raise RuntimeError("Kunde inte bracket-matcha cities-arrayen (saknar ']'?)")


def parse_js_string_at(s: str, i: int):
    """Parse: '...' eller "..." från position i. Returnerar (value, next_index)."""
    quote = s[i]
    assert quote in ("'", '"')
    i += 1
    out = []
    esc = False
    while i < len(s):
        ch = s[i]
        if esc:
            # behåll escaped char (\" \' \\ \n etc) som normal char
            out.append(ch)
            esc = False
        else:
            if ch == "\\":
                esc = True
            elif ch == quote:
                return "".join(out), i + 1
            else:
                out.append(ch)
        i += 1
    raise RuntimeError("Oavslutad sträng i cities.js")


def skip_ws(s: str, i: int) -> int:
    while i < len(s) and s[i].isspace():
        i += 1
    return i


def extract_name_cc_from_cities_array(arr_text: str):
    """
    Går igenom array-texten och plockar ut name + countryCode från varje objekt.
    Vi gör en lättviktig parser: leta efter nycklarna och parse:a strängarna efter :
    """
    s = arr_text
    i = 0
    n = len(s)

    results = []
    cur_name = None
    cur_cc = None
    depth_obj = 0
    in_str = None
    esc = False

    def flush_if_ready():
        nonlocal cur_name, cur_cc
        if cur_name and cur_cc:
            results.append({"name": cur_name, "countryCode": cur_cc})
        cur_name = None
        cur_cc = None

    while i < n:
        ch = s[i]

        # string-state för att inte bli lurad av name inne i strängar
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
            i += 1
            continue

        if ch in ("'", '"'):
            in_str = ch
            i += 1
            continue

        if ch == "{":
            depth_obj += 1
            # startar nytt objekt
            if depth_obj == 1:
                cur_name = None
                cur_cc = None
            i += 1
            continue

        if ch == "}":
            if depth_obj == 1:
                flush_if_ready()
            depth_obj = max(0, depth_obj - 1)
            i += 1
            continue

        # bara leta fält när vi är i ett topp-objekt
        if depth_obj == 1:
            # matcha "name" eller name
            if s.startswith("name", i) and (i == 0 or not (s[i - 1].isalnum() or s[i - 1] == "_")):
                j = i + 4
                j = skip_ws(s, j)
                if j < n and s[j] == ":":
                    j += 1
                    j = skip_ws(s, j)
                    if j < n and s[j] in ("'", '"'):
                        val, j2 = parse_js_string_at(s, j)
                        cur_name = val.strip()
                        i = j2
                        continue

            if s.startswith("countryCode", i) and (i == 0 or not (s[i - 1].isalnum() or s[i - 1] == "_")):
                j = i + len("countryCode")
                j = skip_ws(s, j)
                if j < n and s[j] == ":":
                    j += 1
                    j = skip_ws(s, j)
                    if j < n and s[j] in ("'", '"'):
                        val, j2 = parse_js_string_at(s, j)
                        cur_cc = val.strip().upper()
                        i = j2
                        continue

        i += 1

    return results


def norm_name(x: str) -> str:
    return re.sub(r"\s+", " ", (x or "").strip().lower())


def norm_cc(x: str) -> str:
    return (x or "").strip().upper()


def read_countryinfo_capitals(path: Path):
    raw = path.read_text(encoding="utf-8", errors="ignore")
    lines = [ln for ln in raw.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    wanted = []
    for ln in lines:
        cols = ln.split("\t")
        if len(cols) < 6:
            continue
        cc = norm_cc(cols[0])
        cap = (cols[5] or "").strip()
        if cc and cap:
            wanted.append({"name": cap, "countryCode": cc})
    return wanted


def main():
    base = Path(".").resolve()
    cities_path = base / CITIES_JS
    if not cities_path.exists():
        raise SystemExit(f"Hittar inte {cities_path}")

    js_text = strip_js_comments(cities_path.read_text(encoding="utf-8", errors="ignore"))
    arr_text = find_cities_array_text(js_text)

    pairs = extract_name_cc_from_cities_array(arr_text)
    if len(pairs) < 100:
        raise SystemExit(f"Jag hittade för få cities ({len(pairs)}). Något stämmer inte i parsing.")

    # bygg lookup: name|cc
    city_keys = set()
    # behåll original-stavning från cities (för att matchningen blir exakt)
    city_original = {}
    for p in pairs:
        nm = p.get("name")
        cc = p.get("countryCode")
        if not nm or not cc:
            continue
        key = f"{norm_name(nm)}|{norm_cc(cc)}"
        city_keys.add(key)
        # första vinner (räcker)
        city_original.setdefault(key, {"name": nm, "countryCode": norm_cc(cc)})

    ci_path = base / COUNTRYINFO_TXT
    if not ci_path.exists():
        raise SystemExit(
            "Hittar inte countryInfo.txt.\n"
            "Lägg GeoNames countryInfo.txt i server/ och kör igen."
        )

    wanted = read_countryinfo_capitals(ci_path)

    capitals = []
    missing = []
    seen = set()

    for w in wanted:
        key = f"{norm_name(w['name'])}|{w['countryCode']}"
        if key in city_keys:
            if key not in seen:
                seen.add(key)
                capitals.append(city_original[key])
        else:
            missing.append(w)

    capitals.sort(key=lambda x: (x["countryCode"], norm_name(x["name"])))

    (base / OUT_CAPITALS_JSON).write_text(
        json.dumps(capitals, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    if missing:
        (base / OUT_MISSING_JSON).write_text(
            json.dumps(missing, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    print("✅ Klart!")
    print(f"   Skrev: {base / OUT_CAPITALS_JSON} (antal: {len(capitals)})")
    print(f"   Saknas i cities.js: {len(missing)} (se {base / OUT_MISSING_JSON})")


if __name__ == "__main__":
    main()
