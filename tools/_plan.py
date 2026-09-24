"""The seed's content: templates T1-T6, scenarios S01-S22 and BULK, their creation order, and the
plan the app is expected to show on each scenario in its pristine state.

Pure: no clock, no network, no randomness. Every date and `created_at` is a fixed 2026 value, so the
same code builds the same site. `tools/seed.py` executes it; `fixtures/seed-expectations.json` is
`build()["expectations"]` as written by `seed.py --expectations`.

Sources: the seed-scenario design (sandbox, conventions, templates, scenarios), with Kevin's
2026-09-24 decisions over it and probe 102 (sg-groundtruth #79) for what an apply re-syncs:

- The match key is (content trimmed, casefolded, inner whitespace collapsed; step). So S02's
  `Client  Review` is claimed, not an extra.
- Five counts: keep (already linked to this template's task), claim (same key, link to write),
  create, extra, conflict.
- A candidate already linked to this template's task wins: no conflict, the other same-key Task is an
  extra. A template with two tasks of one key is a conflict too (side "template").
- Pre-pick among candidates: publishes (Versions + PublishedFiles), then a non-default status, then the
  oldest `created_at`. A generated Task's `created_at` is the seed's wall clock: newest.
- Fields (102): overwritten when the template value is non-empty and differs: est_in_mins,
  sg_description, sg_sort_order, task_reviewers, milestone; duration only on a Task without dates;
  task_assignees filled only when empty. `content` differences are listed as renames. A template
  `milestone` false and a milestone's duration 0 count as empty (no seeded case depends on it).
- Read-back values, seen by the seed on the sandbox on 2026-09-24 and not yet in the corpus: Task
  `content` is trimmed on create (so S02's ` animation` and `Comp ` and every `comp ` hand Task are
  stored trimmed; only the inner double space of `Client  Review` survives), and `sg_description` ""
  reads back null. A date write on a root Task (S13 Layout, Tracking) did not pin it.
- S12's FX status is `ready`, not the design's `hld`: `hld` is hidden in the sandbox project.
- Edges between two Tasks linked to the template after the apply: the same one stays, one of another
  type/offset or direction is replaced, one the template lacks is removed. An edge touching any other
  Task is kept (listed for information). A template edge with no existing pair is added.
"""
import copy

TYPES = {"FS": "finish-to-start-next-day", "SS": "start-to-start", "FF": "finish-to-finish"}

SHOT_STEPS = ["Layout", "Tracking", "Animation", "FX", "Roto", "Light", "Comp"]
ASSET_STEPS = ["Design", "Model", "Texture", "Rigging"]

ROLES = ("artist", "artist2")
SEQUENCES = ["TTS_RULES", "TTS_BULK"]
CUSTOM_FALLBACK = "Sequence"
FIELDS = ["est_in_mins", "sg_description", "sg_sort_order", "task_reviewers", "milestone", "duration",
          "task_assignees"]

JAN, FEB, MAR = "2026-01-05T09:00:00Z", "2026-02-05T09:00:00Z", "2026-03-05T09:00:00Z"
HAND_AT = "2026-06-01T09:{:02d}:00Z"   # hand Tasks the design gives no date to, in creation order


def norm(content):
    return " ".join((content or "").split()).casefold()


def label(content, step):
    return f"{content}@{step[0] if step else ''}"


def tt(content, step, sort=None, duration=None, est=None, desc=None, milestone=False, assignees=(),
       reviewers=(), start=None, due=None, step_type=None):
    """A template task. `step` is a Step name; `step_type` its entity type when not the template's."""
    s = [step, step_type] if step else None
    return {"label": label(content, s), "content": content, "step": s, "sg_sort_order": sort,
            "duration": None if milestone else duration, "est_in_mins": est, "sg_description": desc,
            "milestone": milestone, "task_assignees": list(assignees), "task_reviewers": list(reviewers),
            "start_date": start, "due_date": due}


def edge(up, down, kind="FS", offset=None):
    """`up -> down`: down depends on up. On the wire `task` = down, `dependent_task` = up (085)."""
    return {"up": up, "down": down, "type": TYPES[kind], "offset": offset}


def _typed(template):
    for t in template["tasks"]:
        if t["step"] and t["step"][1] is None:
            t["step"][1] = template["entity_type"]
    return template


def templates(custom_type=CUSTOM_FALLBACK):
    L, TR, A, FX, R, LI, C = "Layout@Layout", "Tracking@Tracking", "Animation@Animation", "FX@FX", \
        "Roto@Roto", "Light@Light", "Comp@Comp"
    t1 = {"code": "TT Seed · Shot v1", "entity_type": "Shot", "tasks": [
        tt("Layout", "Layout", 10, 960, desc="Camera and blocking"),
        tt("Tracking", "Tracking", 20, 960),
        tt("Matchmove", "Tracking", 25, 960),
        tt("Animation", "Animation", 30, 2400, 1800, "Body and face"),
        tt("FX", "FX", 40, 1440),
        tt("Roto", "Roto", 50, 960),
        tt("Lighting", "Light", 60, 1440),
        tt("Comp", "Comp", 70, 1440, desc="Final comp"),
        tt("Paint", "Comp", 80, 480),
        tt("Client Review", "Comp", 90, milestone=True),
    ], "edges": [
        edge(L, A), edge(TR, A), edge(A, FX), edge(A, "Lighting@Light"), edge(FX, "Lighting@Light", "SS"),
        edge("Lighting@Light", C), edge(R, C), edge("Paint@Comp", C, "SS"), edge(C, "Client Review@Comp"),
    ]}
    t2 = {"code": "TT Seed · Shot v2", "entity_type": "Shot", "tasks": [
        tt("Layout", "Layout", 10, 1440, desc="Camera, blocking and set dressing"),
        tt("Tracking", "Tracking", 20, 960),
        tt("Animation", "Animation", 30, 2400, 2400, "Body, face and cloth", assignees=["artist2"]),
        tt("FX", "FX", 45, 1440),
        tt("Roto", "Roto", 50, 960),
        tt("Cleanup", "Roto", 52, 960),
        tt("Paint", "Roto", 55, 480),
        tt("Light", "Light", 60, 1440),
        tt("Comp", "Comp", 70, 1440, desc="Final comp"),
        tt("Grade", "Comp", 75, start="2026-03-02", due="2026-03-04"),
        tt("Client Review", "Comp", 90, milestone=True),
    ], "edges": [
        edge(L, A), edge(L, TR, "SS", 2), edge(A, FX, "SS", 2), edge(A, LI, "FS", 1), edge(FX, LI, "FF"),
        edge(LI, C), edge(R, C, "FS", -1), edge("Paint@Roto", C, "SS"), edge("Cleanup@Roto", C),
        edge(C, "Client Review@Comp"), edge(C, "Grade@Comp"),
    ]}
    t3 = {"code": "TT Seed · Shot live", "entity_type": "Shot", "tasks": [
        tt("Layout", "Layout", 10), tt("Animation", "Animation", 30, 2400), tt("Light", "Light", 60),
        tt("Comp", "Comp", 70),
    ], "edges": [edge(L, A), edge(A, LI), edge(LI, C)]}
    t4 = {"code": "TT Seed · Asset", "entity_type": "Asset", "tasks": [
        tt("Design", "Design", 10), tt("Model", "Model", 20, 2400), tt("Texture", "Texture", 30),
        tt("Rig", "Rigging", 40),
    ], "edges": [edge("Design@Design", "Model@Model"), edge("Model@Model", "Texture@Texture"),
                 edge("Model@Model", "Rig@Rigging", "SS", 2)]}
    # An Asset template meant for a Shot: its Comp is the Shot step, so a Shot's Comp matches it.
    t5 = {"code": "TT Seed · Asset on Shot", "entity_type": "Asset", "tasks": [
        tt("Model", "Model", 10), tt("Comp", "Comp", 20, step_type="Shot"),
    ], "edges": [edge("Model@Model", "Comp@Comp")]}
    t6 = {"code": f"TT Seed · {custom_type}", "entity_type": custom_type, "tasks": [
        tt("Brief", None, 10), tt("Build", None, 20),
    ], "edges": [edge("Brief@", "Build@")]}
    out = {"T1": t1, "T2": t2, "T3": t3, "T4": t4, "T5": t5, "T6": t6}
    return {k: _typed(v) for k, v in out.items()}


def t3_edit():
    """Written after S22's Shots exist: the template moves on under live entities."""
    return {"tasks": [_typed({"entity_type": "Shot", "tasks": [tt("Previs", "Layout", 5)]})["tasks"][0]],
            "update_tasks": {"Animation@Animation": {"duration": 3360}},
            "edges": [edge("Previs@Layout", "Layout@Layout"), edge("Layout@Layout", "Light@Light", "SS")],
            "update_edges": [{"up": "Light@Light", "down": "Comp@Comp", "set": {"offset_days": 1}}]}


def edited_t3(t3):
    t = copy.deepcopy(t3)
    ed = t3_edit()
    t["tasks"] = ed["tasks"] + t["tasks"]
    for x in t["tasks"]:
        x.update(ed["update_tasks"].get(x["label"], {}))
    t["edges"] = ed["edges"] + t["edges"]
    for u in ed["update_edges"]:
        for e in t["edges"]:
            if (e["up"], e["down"]) == (u["up"], u["down"]):
                e["offset"] = u["set"]["offset_days"]
    return t


# -- scenarios ---------------------------------------------------------------------------------------

def hand(lbl, content, step, status=None, created_at=None, step_type=None):
    return {"label": f"hand:{lbl}", "content": content, "step": [step, step_type] if step else None,
            "status": status, "created_at": created_at}


def ent(code, created_with=None, hands=(), edges=(), links=(), updates=None, deletes=(), versions=None,
        pfs=None, dates=()):
    return {"code": code, "created_with": created_with, "hand": list(hands), "edges": list(edges),
            "links": [list(x) for x in links], "updates": updates or {}, "deletes": list(deletes),
            "versions": versions or {}, "pfs": pfs or {}, "dates": [list(d) for d in dates]}


def scen(sid, name, entity_type, entities, apply, default=False, sequence="TTS_RULES"):
    return {"id": sid, "name": name, "entity_type": entity_type, "sequence": sequence if entity_type == "Shot" else None,
            "entities": entities, "apply": apply, "default": default}


def scenarios(custom_type=CUSTOM_FALLBACK):
    s = []
    s.append(scen("S01", "exact", "Shot", [ent("tts_exact", hands=[
        hand("Layout", "Layout", "Layout"), hand("Animation", "Animation", "Animation"), hand("Comp", "Comp", "Comp")],
        edges=[edge("hand:Layout", "hand:Animation", "SS")])], "T2"))
    s.append(scen("S02", "case", "Shot", [ent("tts_case", hands=[
        hand("LAYOUT", "LAYOUT", "Layout"), hand("animation", " animation", "Animation"),
        hand("Comp", "Comp ", "Comp"), hand("CLEANUP", "CLEANUP", "Roto"),
        hand("Client Review", "Client  Review", "Comp")])], "T2"))
    s.append(scen("S03", "step", "Shot", [ent("tts_step", hands=[
        hand("Comp@Light", "Comp", "Light"), hand("Roto@Comp", "Roto", "Comp"), hand("Layout@", "Layout", None)])],
        "T2"))
    s.append(scen("S04", "claim", "Shot", [ent("tts_claim", "T1")], "T2"))
    s.append(scen("S05", "loose claim", "Shot", [ent("tts_claim_loose", hands=[hand("Comp", "Comp", "Comp")],
                                                     links=[("hand:Comp", "T1", "Comp@Comp")])], "T2"))
    s.append(scen("S06", "conflict pubs", "Shot", [ent("tts_cf_pubs", hands=[
        hand("Comp#1", "Comp", "Comp", created_at=JAN), hand("Comp#2", "Comp", "Comp", created_at=FEB)],
        versions={"hand:Comp#2": 1}, pfs={"hand:Comp#2": 1})], "T2"))
    s.append(scen("S07", "conflict status", "Shot", [ent("tts_cf_status", hands=[
        hand("Comp#1", "Comp", "Comp", created_at=JAN), hand("Comp#2", "Comp", "Comp", "ip", FEB)])], "T2"))
    s.append(scen("S08", "conflict oldest", "Shot", [ent("tts_cf_oldest", hands=[
        hand("Comp#1", "Comp", "Comp", created_at=MAR), hand("Comp#2", "Comp", "Comp", created_at=JAN),
        hand("Comp#3", "Comp", "Comp", created_at=FEB)])], "T2"))
    s.append(scen("S09", "conflict order", "Shot", [ent("tts_cf_order", hands=[
        hand("Comp#1", "Comp", "Comp", "ip", JAN), hand("Comp#2", "Comp", "Comp", created_at=FEB)],
        versions={"hand:Comp#2": 1})], "T2"))
    s.append(scen("S10", "conflict mixed", "Shot", [ent("tts_cf_mixed", "T1", hands=[
        hand("comp @Comp", "comp ", "Comp", "ip", JAN)])], "T2"))
    s.append(scen("S11", "extras", "Shot", [ent("tts_extras", "T1", updates={
        "Lighting@Light": {"sg_status_list": "fin"}, "Matchmove@Tracking": {"sg_status_list": "ip"}},
        versions={"Lighting@Light": 2}, pfs={"Lighting@Light": 1, "Matchmove@Tracking": 1})], "T2"))
    s.append(scen("S12", "state", "Shot", [ent("tts_state", "T1", updates={
        "Layout@Layout": {"sg_status_list": "fin"},
        "Tracking@Tracking": {"sg_status_list": "apr"},
        "Animation@Animation": {"sg_status_list": "ip", "task_assignees": ["artist"], "task_reviewers": ["artist2"]},
        "FX@FX": {"sg_status_list": "ready"},     # the design's `hld` is hidden in the sandbox project
        "Roto@Roto": {"sg_status_list": "rev"},
        "Comp@Comp": {"sg_status_list": "ip", "task_assignees": ["artist", "artist2"]},
        "Matchmove@Tracking": {"sg_status_list": "omt"}})], "T2"))
    s.append(scen("S13", "dates", "Shot", [ent("tts_dates", "T1", dates=[
        ("Layout@Layout", {"start_date": "2026-11-02", "due_date": "2026-11-03"}),
        ("Tracking@Tracking", {"start_date": "2026-11-02", "due_date": "2026-11-03"}),
        ("Comp@Comp", {"pinned": True}),
        ("Client Review@Comp", {"start_date": "2026-11-02", "due_date": "2026-11-02"})])], "T2"))
    s.append(scen("S14", "fields", "Shot", [ent("tts_fields", "T1", updates={
        "Layout@Layout": {"duration": 1920, "sg_description": None},
        "Animation@Animation": {"sg_description": "Studio note: keep", "est_in_mins": None},
        "FX@FX": {"sg_sort_order": 99},
        "Client Review@Comp": {"milestone": False},
        "Comp@Comp": {"sg_description": ""}})], "T2"))
    s.append(scen("S15", "keep linked", "Shot", [ent("tts_linked", "T2", hands=[hand("Retime", "Retime", "Comp")],
                                                     updates={"Layout@Layout": {"sg_status_list": "ip"}},
                                                     deletes=["Grade@Comp"])], "T2"))
    s.append(scen("S16", "mismatch", "Shot", [ent("tts_mismatch", hands=[hand("Comp", "Comp", "Comp")])], "T5"))
    s.append(scen("S17", "asset", "Asset", [ent("tts_asset", hands=[
        hand("model", "model", "Model", "ip"), hand("Rig", "Rig", "Rigging"), hand("Groom", "Groom", "Texture")],
        versions={"hand:Rig": 1})], "T4"))
    s.append(scen("S18", "custom", custom_type, [ent("tts_custom", hands=[hand("brief", "brief", None)])], "T6"))
    s.append(scen("S19", "default bare", "Shot", [ent("tts_def_bare")], "T2", default=True))
    s.append(scen("S20", "default hand", "Shot", [ent("tts_def_hand", hands=[
        hand("Layout", "Layout", "Layout", "ip"), hand("comp", "comp", "Comp")])], "T2", default=True))
    s.append(scen("S21", "default asset", "Asset", [ent("tts_def_asset")], "T4", default=True))
    s.append(scen("S22", "live", "Shot", [ent(f"tts_live_{i:02d}", "T3") for i in range(1, 5)], "T3"))
    bulk = []
    for n in range(1, 31):
        hands, updates, versions = [], {}, {}
        if n % 5 == 0:
            updates["Animation@Animation"] = {"sg_status_list": "ip"}
        if n in (7, 14, 21, 28):
            hands.append(hand("Retime", "Retime", "Comp"))
        if n in (3, 13, 23):
            hands.append(hand("comp @Comp", "comp ", "Comp", created_at=JAN))
        if n in (11, 22):
            versions["Lighting@Light"] = 1
        bulk.append(ent(f"tts_bulk_{n:03d}", "T1", hands=hands, updates=updates, versions=versions))
    s.append(scen("BULK", "bulk", "Shot", bulk, "T2", sequence="TTS_BULK"))
    _date_hands(s)
    for sc in s:
        for e in sc["entities"]:
            for h in e["hand"]:
                if h["step"] and h["step"][1] is None:
                    h["step"][1] = sc["entity_type"]
    return s


def _date_hands(scens):
    i = 0
    for sc in scens:
        for e in sc["entities"]:
            for h in e["hand"]:
                if h["created_at"] is None:
                    h["created_at"] = HAND_AT.format(i % 60)
                    i += 1


# -- the entity as the seed leaves it ------------------------------------------------------------------

def seeded_tasks(e, tpls):
    """The Tasks the entity holds once seeded, as the planner sees them, read-back values included.

    Generated Tasks copy their template task (083). A Task is dated where the seed writes dates and
    downstream of one (087's cascade). Seen by the seed on the sandbox, 2026-09-24, not yet in the
    corpus: `content` is trimmed on create (inner runs kept), and `sg_description` "" reads back null.
    """
    out = []
    if e["created_with"]:
        t = tpls[e["created_with"]]
        for x in t["tasks"]:
            if x["label"] in e["deletes"]:
                continue
            out.append({"label": x["label"], "content": x["content"], "step": x["step"],
                        "template_task": [e["created_with"], x["label"]], "status": None, "created_at": None,
                        "est_in_mins": x["est_in_mins"], "sg_description": x["sg_description"],
                        "sg_sort_order": x["sg_sort_order"], "task_reviewers": [],
                        "milestone": x["milestone"], "duration": 0 if x["milestone"] else x["duration"],
                        "task_assignees": list(x["task_assignees"]),
                        "dated": bool(x["start_date"] or x["due_date"])})
    for h in e["hand"]:
        out.append({"label": h["label"], "content": h["content"].strip(), "step": h["step"], "template_task": None,
                    "status": h["status"], "created_at": h["created_at"], "est_in_mins": None,
                    "sg_description": None, "sg_sort_order": None, "task_reviewers": [], "milestone": False,
                    "duration": None, "task_assignees": [], "dated": False})
    by = {t["label"]: t for t in out}
    for lbl, tpl, tlabel in e["links"]:
        by[lbl]["template_task"] = [tpl, tlabel]
    for lbl, patch in e["updates"].items():
        for k, v in patch.items():
            by[lbl]["status" if k == "sg_status_list" else k] = None if v == "" else v
    dated = [lbl for lbl, patch in e["dates"] if "start_date" in patch or "due_date" in patch]
    down = {}
    for x in seeded_edges(e, tpls):
        down.setdefault(x["up"], []).append(x["down"])
    while dated:
        lbl = dated.pop()
        if lbl in by and not by[lbl]["dated"]:
            by[lbl]["dated"] = True
            dated += down.get(lbl, [])
    for t in out:
        t["versions"] = e["versions"].get(t["label"], 0)
        t["pfs"] = e["pfs"].get(t["label"], 0)
    return out


def seeded_edges(e, tpls):
    edges = []
    if e["created_with"]:
        for x in tpls[e["created_with"]]["edges"]:
            if x["up"] not in e["deletes"] and x["down"] not in e["deletes"]:
                edges.append(dict(x))
    return edges + [dict(x) for x in e["edges"]]


# -- the expected plan -------------------------------------------------------------------------------

def _key(content, step):
    return (norm(content), tuple(step) if step else None)


def _empty(v):
    return v is None or v == "" or v == [] or v is False or v == 0


def _prepick(cands):
    def rank(t):
        pubs = t.get("versions", 0) + t.get("pfs", 0)
        return (-pubs, 0 if t.get("status") else 1, t.get("created_at") or "9999")
    ordered = sorted(cands, key=rank)
    best, second = ordered[0], ordered[1]
    rb, rs = rank(best), rank(second)
    reason = "publishes" if rb[0] != rs[0] else "status" if rb[1] != rs[1] else "oldest"
    return best, reason


def expect(tkey, tpl, tasks, edges, entity_type, on_template):
    """The plan for applying template `tkey` (`tpl`) to an entity holding `tasks` and `edges`."""
    tpl = _typed(copy.deepcopy(tpl))
    mine = {t["label"]: t for t in tpl["tasks"]}
    assigned = {}        # template label -> entity task
    kind = {}            # template label -> keep | claim | create | conflict
    used = set()
    for t in tasks:
        link = t.get("template_task")
        if link and link[0] == tkey and link[1] in mine and link[1] not in assigned:
            assigned[link[1]] = t
            kind[link[1]] = "keep"
            used.add(t["label"])
    groups = {}
    for x in tpl["tasks"]:
        if x["label"] not in assigned:
            groups.setdefault(_key(x["content"], x["step"]), []).append(x)
    conflicts = []
    reserved = set()
    for k, xs in groups.items():
        cands = [t for t in tasks if t["label"] not in used and _key(t["content"], t["step"]) == k]
        if len(xs) > 1:
            conflicts.append({"side": "template", "key": list(k[:1]) + [list(k[1]) if k[1] else None],
                              "template_tasks": [x["label"] for x in xs],
                              "candidates": [t["label"] for t in cands], "prepick": None, "reason": None})
            reserved |= {t["label"] for t in cands}
            for x in xs:
                kind[x["label"]] = "conflict"
            continue
        x = xs[0]
        if not cands:
            kind[x["label"]] = "create"
        elif len(cands) == 1:
            kind[x["label"]] = "claim"
            assigned[x["label"]] = cands[0]
            used.add(cands[0]["label"])
        else:
            best, reason = _prepick(cands)
            kind[x["label"]] = "conflict"
            assigned[x["label"]] = best
            reserved |= {t["label"] for t in cands}
            conflicts.append({"side": "entity", "task": x["label"], "candidates": [t["label"] for t in cands],
                              "prepick": best["label"], "reason": reason})
    counts = {k: 0 for k in ("keep", "claim", "create", "extra", "conflict")}
    for x in tpl["tasks"]:
        if kind[x["label"]] != "conflict":
            counts[kind[x["label"]]] += 1
    counts["conflict"] = len(conflicts)
    extras = [t for t in tasks if t["label"] not in used and t["label"] not in reserved]
    counts["extra"] = len(extras)

    renames = []
    for x in tpl["tasks"]:
        t = assigned.get(x["label"])
        if t is not None and t["content"] != x["content"]:
            renames.append({"task": t["label"], "from": t["content"], "to": x["content"],
                            "linked": kind[x["label"]] == "keep"})
    renames.sort(key=lambda r: [t["label"] for t in tasks].index(r["task"]))

    fields = []
    for x in tpl["tasks"]:
        t = assigned.get(x["label"])
        if t is None:
            continue
        for f in FIELDS:
            want, have = x.get(f), t.get(f)
            if _empty(want) or want == have:
                continue
            if f == "duration" and t.get("dated"):
                continue
            if f == "task_assignees" and not _empty(have):
                continue
            fields.append({"task": t["label"], "field": f, "current": have, "template": want,
                           "kind": "fill" if _empty(have) and have is not False else "overwrite"})
    order = {f: i for i, f in enumerate(FIELDS)}
    tl = [x["label"] for x in tpl["tasks"]]
    fields.sort(key=lambda d: (tl.index(_tlabel(assigned, d["task"])), order[d["field"]]))

    to_t = {t["label"]: lbl for lbl, t in assigned.items()}
    tedges = {(e["up"], e["down"]): e for e in tpl["edges"]}
    out = {"same": [], "replaced": [], "removed": [], "kept": [], "added": []}
    covered = set()
    for e in edges:
        a, b = to_t.get(e["up"]), to_t.get(e["down"])
        if a is None or b is None:
            out["kept"].append({"up": e["up"], "down": e["down"], "type": e["type"], "offset": e["offset"]})
            continue
        te = tedges.get((a, b)) or tedges.get((b, a))
        if te is None:
            out["removed"].append({"up": a, "down": b, "type": e["type"], "offset": e["offset"]})
            continue
        covered.add((te["up"], te["down"]))
        if (te["up"], te["down"]) == (a, b) and (te["type"], te["offset"]) == (e["type"], e["offset"]):
            out["same"].append({"up": a, "down": b})
        else:
            out["replaced"].append({"up": te["up"], "down": te["down"], "from": [e["type"], e["offset"]],
                                    "to": [te["type"], te["offset"]]})
    for te in tpl["edges"]:
        if (te["up"], te["down"]) not in covered:
            out["added"].append({"up": te["up"], "down": te["down"], "type": te["type"], "offset": te["offset"]})
    out["counts"] = {k: len(out[k]) for k in ("same", "replaced", "removed", "kept", "added")}

    return {"counts": counts, "conflicts": conflicts,
            "extras": [{"task": t["label"], "versions": t.get("versions", 0), "pfs": t.get("pfs", 0),
                        "status": t.get("status")} for t in extras],
            "renames": renames, "fields": fields, "edges": out,
            "mismatch": tpl["entity_type"] != entity_type, "on_template": on_template == tkey}


def _tlabel(assigned, task_label):
    return next(lbl for lbl, t in assigned.items() if t["label"] == task_label)


# -- the whole seed ----------------------------------------------------------------------------------

ORDER = [
    ("resolve", "project, steps, people, Task statuses, custom type, tracking_settings (reads)"),
    ("templates", "TaskTemplate T1-T6, one POST each (a batch create of a project-less row is report 001)"),
    ("template_tasks", "one POST /entity/tasks each, task_template set, no project (TaskTemplate card; Q6)"),
    ("template_edges", "one _batch of TaskDependency per template, after its tasks (086)"),
    ("sequences", "TTS_RULES, TTS_BULK, one _batch"),
    ("entities", "per scenario: one _batch of entity creates, chunks of 10, task_template on the templated ones (083)"),
    ("read_generated", "_search Tasks on the entities, map label -> id (083: the 201 body lists none)"),
    ("hand_tasks", "one _batch, always with project, created_at on create (070)"),
    ("hand_edges_and_links", "_batch TaskDependency; S05 template_task by a batch update (recipe 015)"),
    ("mutations", "_batch updates and deletes"),
    ("publishes", "_batch Versions, then PublishedFiles, with project, no path"),
    ("dates", "S13: one PUT each, in order (087)"),
    ("t3_edit", "after S22: POST Previs, PUT Animation duration, TaskDependency create and PUT"),
    ("tracking_settings", "read only: the write is unmeasured (Q7); printed for Kevin to set by hand"),
    ("verify", "read back every scenario, write the manifest"),
]


def build(custom_type=CUSTOM_FALLBACK):
    tpls = templates(custom_type)
    scens = scenarios(custom_type)
    live = {**tpls, "T3": edited_t3(tpls["T3"])}
    exp = {}
    for sc in scens:
        ents = {}
        for e in sc["entities"]:
            ents[e["code"]] = expect(sc["apply"], live[sc["apply"]], seeded_tasks(e, tpls),
                                     seeded_edges(e, tpls), sc["entity_type"], e["created_with"])
        exp[sc["id"]] = {"name": sc["name"], "apply": sc["apply"], "default": sc["default"], "entities": ents}
    filters = {}
    for sc in scens:
        for e in sc["entities"]:
            k = e["created_with"] or f"{sc['entity_type']}:none"
            filters[k] = filters.get(k, 0) + 1
    return {"templates": tpls, "t3_edit": t3_edit(), "sequences": list(SEQUENCES), "scenarios": scens,
            "order": [list(o) for o in ORDER], "expectations": exp, "filters": filters,
            "default_task_template": {"Shot": "T2", "Asset": "T4"}}


def needed_steps(plan):
    """(name, entity_type) of every Step the seed names."""
    out = set()
    for t in list(plan["templates"].values()) + [{"tasks": plan["t3_edit"]["tasks"]}]:
        for x in t["tasks"]:
            if x["step"]:
                out.add(tuple(x["step"]))
    for sc in plan["scenarios"]:
        for e in sc["entities"]:
            for h in e["hand"]:
                if h["step"]:
                    out.add((h["step"][0], h["step"][1] or sc["entity_type"]))
    return sorted(out)


def needed_statuses(plan):
    out = set()
    for sc in plan["scenarios"]:
        for e in sc["entities"]:
            out |= {h["status"] for h in e["hand"] if h["status"]}
            for patch in e["updates"].values():
                if "sg_status_list" in patch:
                    out.add(patch["sg_status_list"])
    return sorted(out)


def summary(plan):
    lines = ["scenario  entities  apply  keep claim create extra conflict"]
    for sc in plan["scenarios"]:
        ents = plan["expectations"][sc["id"]]["entities"]
        tot = {k: sum(e["counts"][k] for e in ents.values()) for k in ("keep", "claim", "create", "extra", "conflict")}
        lines.append(f"{sc['id']:<9} {len(ents):>8}  {sc['apply']:<5}  {tot['keep']:>4} {tot['claim']:>5} "
                     f"{tot['create']:>6} {tot['extra']:>5} {tot['conflict']:>8}  {sc['name']}")
    return "\n".join(lines)
