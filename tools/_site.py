"""Plumbing for the seed: the corpus client, env, search, batch, manifest. After sg-notes' tools/_site.py.

Everything goes through `sg-groundtruth`'s `FPT` client so what the seed does is what the corpus
measured. Credentials are that repo's `.env.local`; nothing here reads or prints them.
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _groundtruth():
    """The corpus checkout: $SG_GROUNDTRUTH, else a sibling of this checkout or of its worktree folder."""
    if os.environ.get("SG_GROUNDTRUTH"):
        return Path(os.environ["SG_GROUNDTRUTH"])
    for d in (ROOT.parent / "sg-groundtruth", ROOT.parent.parent / "sg-groundtruth"):
        if (d / "src" / "sg_groundtruth").is_dir():
            return d
    raise SystemExit("no sg-groundtruth checkout next to this one: set SG_GROUNDTRUTH")


GROUNDTRUTH = _groundtruth()
sys.path.insert(0, str(GROUNDTRUTH / "src"))

from sg_groundtruth.client import FPT  # noqa: E402
from sg_groundtruth.env import load  # noqa: E402

JSON = {"Content-Type": "application/json"}
# `_search` takes the vendor array type; every other write takes plain JSON (probe 014, recipe 002).
ARR = {"Content-Type": "application/vnd+shotgun.api3_array+json"}
MANIFEST = ROOT / "fixtures" / "seed-manifest.json"
EXPECTATIONS = ROOT / "fixtures" / "seed-expectations.json"
BATCH = 100   # recipe 002: keep a batch well inside the response window (~200)


def env():
    if not (GROUNDTRUTH / ".env.local").exists():
        raise SystemExit(f"no {GROUNDTRUTH / '.env.local'}: the seed reads the corpus repo's credentials")
    return load(GROUNDTRUTH)


def client(e):
    return FPT.from_env(e)


def ok(r, what):
    if not r.ok:
        raise SystemExit(f"{what} -> {r.status_code} {r.text[:500]}")
    return r.json()["data"] if r.content else None


def search_all(c, slug, filters, fields, sort=None, size=200):
    """Every page of a `_search`. `links.next` is emitted forever, so stop on a short page (probe 006)."""
    out, number = [], 1
    while True:
        body = {"filters": filters, "fields": fields, "page": {"size": size, "number": number}}
        if sort:
            body["sort"] = sort
        rows = ok(c.post(f"/entity/{slug}/_search", headers=ARR, json=body), f"search {slug}")
        out += rows
        if len(rows) < size:
            return out
        number += 1


def search_in(c, slug, field, refs, extra, fields):
    """`field in refs`, chunked. `in` on an entity field takes full {type, id} hashes (017)."""
    out = []
    for i in range(0, len(refs), 100):
        out += search_all(c, slug, [[field, "in", refs[i:i + 100]]] + extra, fields)
    return out


def batch(c, reqs, what):
    """Atomic `_batch` calls in chunks; rows come back in request order (recipe 002)."""
    rows = []
    for i in range(0, len(reqs), BATCH):
        rows += ok(c.post("/entity/_batch", headers=JSON, json={"requests": reqs[i:i + BATCH]}), what)
    return rows


def row_id(row):
    """A create or update row nests the record under `data`; a delete row is flat (recipe 002)."""
    return row.get("data", row)["id"]


def project_id(c, e):
    """The one project the seed may write into, by the name the corpus repo's env names."""
    name = (e.get("FPT_PROBE_SANDBOX_PROJECT") or "").strip()
    if not name:
        raise SystemExit("set FPT_PROBE_SANDBOX_PROJECT in sg-groundtruth/.env.local")
    rows = search_all(c, "projects", [["name", "is", name]], ["name"])
    if len(rows) != 1:
        raise SystemExit(f"{len(rows)} projects named {name!r}: the seed needs exactly one")
    return rows[0]["id"]


def rel(row, field):
    """A relationship's `data`: a dict, a list, or None."""
    return (row.get("relationships", {}).get(field) or {}).get("data")


def rel_id(row, field):
    d = rel(row, field)
    return d["id"] if d else None


def read_json(p):
    return json.loads(p.read_text()) if p.exists() else None


def write_json(p, data):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=1, ensure_ascii=False, sort_keys=False) + "\n")
