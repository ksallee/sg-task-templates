"""Unit tests for tools/_plan.py, the pure half of the seed.

    uv run --with pytest pytest tools -q

The counts are the seed-scenario design's "expected plan" column with the 2026-09-24 decisions
applied (inner whitespace collapsed, a linked candidate wins, duplicate template keys conflict) and
probe 102's re-sync rules for field diffs and edges.
"""
import json

import pytest

import _plan

PLAN = _plan.build()


def counts(sid, code=None):
    ents = PLAN["expectations"][sid]["entities"]
    e = ents[code] if code else next(iter(ents.values()))
    return e["counts"]


def entity(sid, code=None):
    ents = PLAN["expectations"][sid]["entities"]
    return ents[code] if code else next(iter(ents.values()))


def c(keep=0, claim=0, create=0, extra=0, conflict=0):
    return {"keep": keep, "claim": claim, "create": create, "extra": extra, "conflict": conflict}


# -- normalisation ---------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,key", [
    ("Layout", "layout"), ("LAYOUT", "layout"), (" animation", "animation"), ("Comp ", "comp"),
    ("Client  Review", "client review"), ("Client\tReview", "client review"), ("Straße", "strasse"),
])
def test_norm_trims_casefolds_and_collapses(raw, key):
    assert _plan.norm(raw) == key


def test_norm_of_none_is_empty():
    assert _plan.norm(None) == ""


# -- determinism and shape ---------------------------------------------------------------------------

def test_build_is_deterministic_and_json():
    a, b = _plan.build(), _plan.build()
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_scenario_ids():
    ids = [s["id"] for s in PLAN["scenarios"]]
    assert ids == [f"S{i:02d}" for i in range(1, 23)] + ["BULK"]


def test_entity_codes_are_prefixed_and_unique():
    codes = [e["code"] for s in PLAN["scenarios"] for e in s["entities"]]
    assert len(codes) == len(set(codes)) == 21 + 4 + 30
    assert all(code.startswith("tts_") for code in codes)


def test_templates():
    t = PLAN["templates"]
    assert [k for k in t] == ["T1", "T2", "T3", "T4", "T5", "T6"]
    assert t["T1"]["code"] == "TT Seed · Shot v1"
    assert len(t["T1"]["tasks"]) == 10 and len(t["T1"]["edges"]) == 9
    assert len(t["T2"]["tasks"]) == 11 and len(t["T2"]["edges"]) == 11
    assert len(t["T3"]["tasks"]) == 4 and len(t["T3"]["edges"]) == 3
    assert len(t["T4"]["tasks"]) == 4 and len(t["T4"]["edges"]) == 3
    assert t["T5"]["entity_type"] == "Asset"
    assert [s["step"] for s in t["T5"]["tasks"]] == [["Model", "Asset"], ["Comp", "Shot"]]
    assert [s["step"] for s in t["T6"]["tasks"]] == [None, None]


def test_template_edges_name_their_tasks():
    for t in PLAN["templates"].values():
        labels = {x["label"] for x in t["tasks"]}
        for e in t["edges"]:
            assert e["up"] in labels and e["down"] in labels


def test_t3_edit():
    edit = PLAN["t3_edit"]
    assert [x["label"] for x in edit["tasks"]] == ["Previs@Layout"]
    assert edit["update_tasks"] == {"Animation@Animation": {"duration": 3360}}
    assert len(edit["edges"]) == 2 and len(edit["update_edges"]) == 1


def test_milestone_task_sends_no_duration():
    cr = next(x for x in PLAN["templates"]["T2"]["tasks"] if x["content"] == "Client Review")
    assert cr["milestone"] is True and cr["duration"] is None


def test_creation_order():
    assert [s[0] for s in PLAN["order"]][:4] == ["resolve", "templates", "template_tasks", "template_edges"]


# -- expected counts per scenario --------------------------------------------------------------------

@pytest.mark.parametrize("sid,want", [
    ("S01", c(claim=3, create=8)),
    ("S02", c(claim=5, create=6)),            # decisions: inner whitespace collapsed
    ("S03", c(create=11, extra=3)),
    ("S04", c(claim=7, create=4, extra=3)),
    ("S05", c(claim=1, create=10)),
    ("S06", c(conflict=1, create=10)),
    ("S07", c(conflict=1, create=10)),
    ("S08", c(conflict=1, create=10)),
    ("S09", c(conflict=1, create=10)),
    ("S10", c(conflict=1, claim=6, create=4, extra=3)),
    ("S11", c(claim=7, create=4, extra=3)),
    ("S12", c(claim=7, create=4, extra=3)),
    ("S13", c(claim=7, create=4, extra=3)),
    ("S14", c(claim=7, create=4, extra=3)),
    ("S15", c(keep=10, create=1, extra=1)),
    ("S16", c(claim=1, create=1)),
    ("S17", c(claim=2, create=2, extra=1)),
    ("S18", c(claim=1, create=1)),
    ("S19", c(create=11)),
    ("S20", c(claim=2, create=9)),
    ("S21", c(create=4)),
])
def test_counts(sid, want):
    assert counts(sid) == want


def test_s22_every_live_shot():
    ents = PLAN["expectations"]["S22"]["entities"]
    assert list(ents) == [f"tts_live_{i:02d}" for i in range(1, 5)]
    for e in ents.values():
        assert e["counts"] == c(keep=4, create=1)
        assert e["on_template"] is True
        assert e["edges"]["counts"] == {"same": 2, "replaced": 1, "removed": 0, "kept": 0, "added": 2}
        assert e["fields"] == [{"task": "Animation@Animation", "field": "duration", "current": 2400,
                                "template": 3360, "kind": "overwrite"}]


def test_bulk_variants():
    ents = PLAN["expectations"]["BULK"]["entities"]
    assert len(ents) == 30
    for n in range(1, 31):
        code = f"tts_bulk_{n:03d}"
        if n in (3, 13, 23):
            assert ents[code]["counts"] == c(conflict=1, claim=6, create=4, extra=3)
            assert ents[code]["conflicts"][0]["prepick"] == "hand:comp @Comp"
            assert ents[code]["conflicts"][0]["reason"] == "oldest"
        elif n in (7, 14, 21, 28):
            assert ents[code]["counts"] == c(claim=7, create=4, extra=4)
        else:
            assert ents[code]["counts"] == c(claim=7, create=4, extra=3)
    lighting = {x["task"]: x for x in ents["tts_bulk_011"]["extras"]}["Lighting@Light"]
    assert (lighting["versions"], lighting["pfs"]) == (1, 0)


# -- conflicts ------------------------------------------------------------------------------------

@pytest.mark.parametrize("sid,pick,reason,n", [
    ("S06", "hand:Comp#2", "publishes", 2),
    ("S07", "hand:Comp#2", "status", 2),
    ("S08", "hand:Comp#2", "oldest", 3),
    ("S09", "hand:Comp#2", "publishes", 2),
    ("S10", "hand:comp @Comp", "status", 2),
])
def test_prepick(sid, pick, reason, n):
    cf = entity(sid)["conflicts"]
    assert len(cf) == 1
    assert (cf[0]["prepick"], cf[0]["reason"], len(cf[0]["candidates"])) == (pick, reason, n)


def test_linked_candidate_wins_no_conflict():
    """decisions: a candidate already linked to this template's task wins; the other is an extra."""
    tpl = {"code": "x", "entity_type": "Shot", "tasks": [_plan.tt("Comp", "Comp", sort=10)], "edges": []}
    tasks = [
        {"label": "a", "content": "Comp", "step": ["Comp", "Shot"], "template_task": ["X", "Comp@Comp"],
         "status": None, "created_at": None, "versions": 0, "pfs": 0},
        {"label": "b", "content": "comp", "step": ["Comp", "Shot"], "template_task": None,
         "status": "ip", "created_at": "2026-01-05T09:00:00Z", "versions": 3, "pfs": 0},
    ]
    out = _plan.expect("X", tpl, tasks, [], entity_type="Shot", on_template=None)
    assert out["counts"] == c(keep=1, extra=1)
    assert out["conflicts"] == []


def test_duplicate_template_key_is_a_conflict():
    tpl = {"code": "x", "entity_type": "Shot", "edges": [],
           "tasks": [_plan.tt("Comp", "Comp", sort=10), _plan.tt("comp ", "Comp", sort=20)]}
    tasks = [{"label": "a", "content": "Comp", "step": ["Comp", "Shot"], "template_task": None,
              "status": None, "created_at": None, "versions": 0, "pfs": 0}]
    out = _plan.expect("X", tpl, tasks, [], entity_type="Shot", on_template=None)
    assert out["counts"] == c(conflict=1)
    assert out["conflicts"][0]["side"] == "template"


# -- renames, edges, fields -------------------------------------------------------------------------

def test_s02_renames():
    """The server trims `content` on create (seen by the seed on the sandbox, 2026-09-24): `Comp ` is
    stored `Comp` and is no rename; the inner double space survives."""
    assert entity("S02")["renames"] == [
        {"task": "hand:LAYOUT", "from": "LAYOUT", "to": "Layout", "linked": False},
        {"task": "hand:animation", "from": "animation", "to": "Animation", "linked": False},
        {"task": "hand:CLEANUP", "from": "CLEANUP", "to": "Cleanup", "linked": False},
        {"task": "hand:Client Review", "from": "Client  Review", "to": "Client Review", "linked": False},
    ]


def test_s10_prepicked_hand_task_is_renamed():
    assert entity("S10")["renames"] == [{"task": "hand:comp @Comp", "from": "comp", "to": "Comp", "linked": False}]


def test_s13_cascade_dates_downstream_of_the_dated_roots():
    tasks = {t["label"]: t for t in _plan.seeded_tasks(PLAN["scenarios"][12]["entities"][0], PLAN["templates"])}
    dated = sorted(k for k, t in tasks.items() if t["dated"])
    assert dated == ["Animation@Animation", "Client Review@Comp", "Comp@Comp", "FX@FX", "Layout@Layout",
                     "Lighting@Light", "Tracking@Tracking"]


def test_s01_hand_edge_is_replaced():
    e = entity("S01")["edges"]
    assert e["counts"] == {"same": 0, "replaced": 1, "removed": 0, "kept": 0, "added": 10}
    assert e["replaced"] == [{"up": "Layout@Layout", "down": "Animation@Animation",
                              "from": ["start-to-start", None], "to": ["finish-to-start-next-day", None]}]


def test_s04_edges():
    e = entity("S04")["edges"]
    assert e["counts"] == {"same": 2, "replaced": 2, "removed": 1, "kept": 4, "added": 7}
    assert e["removed"] == [{"up": "Tracking@Tracking", "down": "Animation@Animation",
                             "type": "finish-to-start-next-day", "offset": None}]


def test_s10_edges_on_the_losing_candidate_are_kept():
    assert entity("S10")["edges"]["counts"] == {"same": 1, "replaced": 1, "removed": 1, "kept": 6, "added": 9}


def test_s15_s17_edges():
    assert entity("S15")["edges"]["counts"] == {"same": 10, "replaced": 0, "removed": 0, "kept": 0, "added": 1}
    assert entity("S17")["edges"]["counts"] == {"same": 0, "replaced": 0, "removed": 0, "kept": 0, "added": 3}


T1_T2_FIELDS = [
    ("Layout@Layout", "sg_description", "Camera and blocking", "Camera, blocking and set dressing", "overwrite"),
    ("Layout@Layout", "duration", 960, 1440, "overwrite"),
    ("Animation@Animation", "est_in_mins", 1800, 2400, "overwrite"),
    ("Animation@Animation", "sg_description", "Body and face", "Body, face and cloth", "overwrite"),
    ("Animation@Animation", "task_assignees", [], ["artist2"], "fill"),
    ("FX@FX", "sg_sort_order", 40, 45, "overwrite"),
]


def fields(sid):
    return [(f["task"], f["field"], f["current"], f["template"], f["kind"]) for f in entity(sid)["fields"]]


def test_s04_fields():
    assert fields("S04") == T1_T2_FIELDS


def test_s12_assignee_not_filled():
    assert fields("S12") == [f for f in T1_T2_FIELDS if f[1] != "task_assignees"]


def test_s13_dated_layout_keeps_duration():
    assert fields("S13") == [f for f in T1_T2_FIELDS if f[:2] != ("Layout@Layout", "duration")]


def test_s14_fields():
    assert fields("S14") == [
        ("Layout@Layout", "sg_description", None, "Camera, blocking and set dressing", "fill"),
        ("Layout@Layout", "duration", 1920, 1440, "overwrite"),
        ("Animation@Animation", "est_in_mins", None, 2400, "fill"),
        ("Animation@Animation", "sg_description", "Studio note: keep", "Body, face and cloth", "overwrite"),
        ("Animation@Animation", "task_assignees", [], ["artist2"], "fill"),
        ("FX@FX", "sg_sort_order", 99, 45, "overwrite"),
        ("Comp@Comp", "sg_description", None, "Final comp", "fill"),   # "" is stored null
        ("Client Review@Comp", "milestone", False, True, "overwrite"),
    ]


def test_s11_extras_usage():
    ex = {x["task"]: (x["versions"], x["pfs"], x["status"]) for x in entity("S11")["extras"]}
    assert ex == {"Matchmove@Tracking": (0, 1, "ip"), "Lighting@Light": (2, 1, "fin"),
                  "Paint@Comp": (0, 0, None)}


def test_warnings():
    assert entity("S16")["mismatch"] is True
    assert entity("S04")["mismatch"] is False
    assert entity("S15")["on_template"] is True
    assert entity("S04")["on_template"] is False


# -- entry filters ------------------------------------------------------------------------------------

def test_entry_filters():
    f = PLAN["filters"]
    assert f["T1"] == 36 and f["T2"] == 1 and f["T3"] == 4
    assert f["Shot:none"] == 11   # the design says 12 and lists 11
    assert f["Asset:none"] == 2
