import io, re, sys, zipfile, unicodedata, math
from dataclasses import dataclass
from pathlib import Path
from urllib.request import urlopen
from collections import defaultdict

GEONAMES_BASE = "https://download.geonames.org/export/dump/"
CITIES_15000_ZIP = "cities15000.zip"
CITIES_500_ZIP   = "cities500.zip"          # för att fånga små huvudstäder
COUNTRY_INFO     = "countryInfo.txt"

# Dina extra-länder:
EXTRA_COUNTRIES = {"US","FR","GB","SE","NO","FI","AU","JP","ES","DE"}

# Regler
MIN_PER_COUNTRY = 2
MAX_PER_COUNTRY = 11

# Din “gamla” logik, men den stoppas av MAX_PER_COUNTRY:
GLOBAL_TOP_N = 200
TOP50_COUNTRIES_N = 50
TOP_CITIES_PER_TOP50 = 3
EXTRA_PER_COUNTRY = 10  # “räcker med 10 per land” – cap:as dessutom till max 11

OUT_JS = Path("server/cities.js")


@dataclass(frozen=True)
class City:
    geonameid: int
    name: str
    asciiname: str
    alternates: tuple[str, ...]
    lat: float
    lon: float
    country: str
    population: int
    feature_code: str


def download_bytes(url: str) -> bytes:
    with urlopen(url) as r:
        return r.read()


def norm_name(s: str) -> str:
    s = (s or "").strip()
    s = re.sub(r"\s+", " ", s)
    return s


def fold_key(s: str) -> str:
    """Aggressiv normalisering för jämförelser/dedupe."""
    s = norm_name(s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower()
    s = re.sub(r"[^\w\s-]", "", s)   # ta bort skiljetecken
    s = re.sub(r"\s+", " ", s).strip()
    return s


def format_population_2sig(n: int) -> str:
    """
    2 gällande siffror + mellanslag som tusentalsavgränsare.
    Ex:
      24874500 -> "25 000 000"
      123456   -> "120 000"
      9800     -> "9 800"
      0        -> "0"
    """
    if n <= 0:
        return "0"
    digits = int(math.floor(math.log10(n))) + 1  # antal siffror
    # runda till 2 gällande => behåll (digits-2) decimaler i heltalsvärlden
    factor = 10 ** max(digits - 2, 0)
    rounded = int(round(n / factor) * factor)
    # tusentalsavgränsare som mellanslag
    return f"{rounded:,}".replace(",", " ")


def load_country_info() -> dict:
    """
    countries[ISO2] = {"population": int, "capital": str, "area": float}
    """
    raw = download_bytes(GEONAMES_BASE + COUNTRY_INFO).decode("utf-8", errors="replace")
    countries = {}
    for line in raw.splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        # ISO, ISO3, ISO-Numeric, fips, Country, Capital, Area, Population, ...
        iso = parts[0].strip()
        capital = parts[5].strip()
        area = float(parts[6]) if parts[6].strip() else 0.0
        pop = int(parts[7]) if parts[7].strip().isdigit() else 0
        if iso:
            countries[iso] = {"population": pop, "capital": capital, "area": area}
    return countries


def load_geonames_zip(zip_name: str) -> list[City]:
    zbytes = download_bytes(GEONAMES_BASE + zip_name)
    zf = zipfile.ZipFile(io.BytesIO(zbytes))
    txt_name = next(n for n in zf.namelist() if n.endswith(".txt"))
    rows = zf.read(txt_name).decode("utf-8", errors="replace").splitlines()

    out: list[City] = []
    for line in rows:
        parts = line.split("\t")
        if len(parts) < 19:
            continue

        geonameid = int(parts[0]) if parts[0].isdigit() else 0
        name = norm_name(parts[1])
        asciiname = norm_name(parts[2])
        alternatenames = tuple(n for n in parts[3].split(",") if n) if parts[3] else tuple()
        lat = float(parts[4])
        lon = float(parts[5])
        fcode = parts[7]
        cc = parts[8]
        pop = int(parts[14]) if parts[14].isdigit() else 0

        out.append(City(
            geonameid=geonameid,
            name=name,
            asciiname=asciiname,
            alternates=alternatenames,
            lat=lat,
            lon=lon,
            country=cc,
            population=pop,
            feature_code=fcode
        ))
    return out


def index_by_country(cities: list[City]) -> dict[str, list[City]]:
    by = defaultdict(list)
    for c in cities:
        by[c.country].append(c)
    for cc in by:
        by[cc].sort(key=lambda c: c.population, reverse=True)
    return dict(by)


def city_matches_name(c: City, target: str) -> bool:
    """Matcha capital-namn mot name/asciiname/alternates."""
    t = fold_key(target)
    if not t:
        return False
    if fold_key(c.name) == t or fold_key(c.asciiname) == t:
        return True
    for a in c.alternates:
        if fold_key(a) == t:
            return True
    return False


def find_capital_city(candidates_by_cc: dict[str, list[City]], cc: str, capital_name: str) -> City | None:
    cap = norm_name(capital_name)
    if not cap:
        return None
    xs = candidates_by_cc.get(cc, [])
    if not xs:
        return None

    exact = [c for c in xs if city_matches_name(c, cap)]
    if exact:
        return max(exact, key=lambda c: c.population)

    t = fold_key(cap)
    near = [c for c in xs if fold_key(c.name).startswith(t) or fold_key(c.asciiname).startswith(t)]
    if near:
        return max(near, key=lambda c: c.population)

    return None


def dedupe_keep_best_per_country(cities: list[City]) -> list[City]:
    """Dedupe inom land på normaliserat namn. Behåll högst population vid krock."""
    best: dict[tuple[str, str], City] = {}
    for c in cities:
        key = (c.country, fold_key(c.name))
        prev = best.get(key)
        if prev is None or c.population > prev.population:
            best[key] = c
    return list(best.values())


def add_city(selected_by_cc: dict[str, list[City]], c: City):
    selected_by_cc[c.country].append(c)


def enforce_caps(selected_by_cc: dict[str, list[City]], capitals: dict[str, City]):
    """
    Max MAX_PER_COUNTRY per land.
    Försök alltid behålla huvudstaden om den finns.
    Prioritet: huvudstad + hög population.
    """
    for cc, lst in list(selected_by_cc.items()):
        if not lst:
            continue

        lst = dedupe_keep_best_per_country(lst)
        lst.sort(key=lambda x: x.population, reverse=True)

        cap = capitals.get(cc)
        cap_key = (cc, fold_key(cap.name)) if cap else None
        present_keys = {(x.country, fold_key(x.name)) for x in lst}

        if cap and cap_key not in present_keys:
            lst.append(cap)
            lst = dedupe_keep_best_per_country(lst)
            lst.sort(key=lambda x: x.population, reverse=True)

        if len(lst) > MAX_PER_COUNTRY:
            kept = lst[:MAX_PER_COUNTRY]

            if cap:
                kept_keys = {(x.country, fold_key(x.name)) for x in kept}
                if cap_key not in kept_keys:
                    kept = kept[:-1] + [cap]
                    kept = dedupe_keep_best_per_country(kept)
                    kept.sort(key=lambda x: x.population, reverse=True)
                    kept = kept[:MAX_PER_COUNTRY]

            lst = kept

        selected_by_cc[cc] = lst


def ensure_minimum(selected_by_cc: dict[str, list[City]], fill_by_cc: dict[str, list[City]], capitals: dict[str, City]):
    """
    Minst MIN_PER_COUNTRY per land:
    - huvudstad (om hittas)
    - + största/näst största tills vi har 2
    """
    for cc, fill_list in fill_by_cc.items():
        current = selected_by_cc.get(cc, [])
        current = dedupe_keep_best_per_country(current)
        current.sort(key=lambda x: x.population, reverse=True)

        if len(current) >= MIN_PER_COUNTRY:
            selected_by_cc[cc] = current
            continue

        cap = capitals.get(cc)
        if cap:
            current.append(cap)
            current = dedupe_keep_best_per_country(current)

        if len(current) < MIN_PER_COUNTRY:
            for c in fill_list:
                current.append(c)
                current = dedupe_keep_best_per_country(current)
                if len(current) >= MIN_PER_COUNTRY:
                    break

        current.sort(key=lambda x: x.population, reverse=True)
        selected_by_cc[cc] = current


def main():
    print("Downloading GeoNames…", file=sys.stderr)
    countries = load_country_info()

    cities15000 = load_geonames_zip(CITIES_15000_ZIP)
    cities500   = load_geonames_zip(CITIES_500_ZIP)

    by15000 = index_by_country(cities15000)
    by500   = index_by_country(cities500)

    capitals: dict[str, City] = {}
    for cc, info in countries.items():
        capname = info.get("capital", "")
        cap = find_capital_city(by500, cc, capname) or find_capital_city(by15000, cc, capname)
        if cap:
            capitals[cc] = cap

    selected_by_cc: dict[str, list[City]] = defaultdict(list)

    # A) Basregel: minst 2 per land (huvudstad + största/näst största)
    for cc in countries.keys():
        cap = capitals.get(cc)
        if cap:
            add_city(selected_by_cc, cap)

        pool = by15000.get(cc) or by500.get(cc) or []
        for c in pool[:5]:
            add_city(selected_by_cc, c)

    # B) Global top 200 (från 15000)
    global_sorted = sorted(cities15000, key=lambda c: c.population, reverse=True)
    for c in global_sorted[:GLOBAL_TOP_N]:
        add_city(selected_by_cc, c)

    # C) Top 3 städer i de 50 största länderna (area)
    top50_by_area = sorted(countries.items(), key=lambda kv: kv[1].get("area", 0.0), reverse=True)[:TOP50_COUNTRIES_N]
    for cc, _info in top50_by_area:
        for c in (by15000.get(cc) or [])[:TOP_CITIES_PER_TOP50]:
            add_city(selected_by_cc, c)

    # D) Extra-länder: 10 st per land (men max 11 i slutet)
    for cc in EXTRA_COUNTRIES:
        for c in (by15000.get(cc) or [])[:EXTRA_PER_COUNTRY]:
            add_city(selected_by_cc, c)

    ensure_minimum(selected_by_cc, by500, capitals)
    enforce_caps(selected_by_cc, capitals)

    selected: list[City] = []
    for _cc, lst in selected_by_cc.items():
        selected.extend(lst)

    selected = dedupe_keep_best_per_country(selected)
    selected.sort(key=lambda c: c.population, reverse=True)

    # Skriv server/cities.js (EXAKT format enligt din mall)
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    with OUT_JS.open("w", encoding="utf-8") as f:
        f.write("// Auto-generated from GeoNames (cities15000 + countryInfo)\n")
        f.write("export const cities = [\n")
        for c in selected:
            safe_name = c.name.replace("\\", "\\\\").replace('"', '\\"')
            pop_str = format_population_2sig(c.population)
            f.write(
                f'  {{ name: "{safe_name}", lat: {c.lat:.6f}, lon: {c.lon:.6f}, countryCode: "{c.country}", population: "{pop_str}" }},\n'
            )
        f.write("];\n")

    # Rapport
    per_cc = defaultdict(int)
    for c in selected:
        per_cc[c.country] += 1
    worst = max(per_cc.values()) if per_cc else 0
    under2 = [cc for cc in countries.keys() if per_cc.get(cc, 0) < MIN_PER_COUNTRY]

    print(f"Wrote {OUT_JS} with {len(selected)} cities", file=sys.stderr)
    print(f"Max cities in a country: {worst}", file=sys.stderr)
    if under2:
        print(f"Countries under {MIN_PER_COUNTRY}: {len(under2)}", file=sys.stderr)
        print("Examples:", under2[:20], file=sys.stderr)


if __name__ == "__main__":
    main()
