"""Unit tests for tools/_plan.py, the pure half of the seed.

    uv run --with pytest pytest tools -q

The counts are the seed-scenario design's "expected plan" column with the 2026-09-24 decisions
applied (inner whitespace collapsed, a linked candidate wins, duplicate template keys conflict),
probe 102's re-sync rules and probe rounds 2 and 3 (103-112), counted as the app's planner does.
src/lib/pure/seed.test.ts checks the same expectations against the app's planner.
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


def edge_counts(**k):
    out = dict.fromkeys(("same", "replaced", "removed", "outside_upstream", "kept", "untouched", "added",
                         "closes_loop"), 0)
    out.update(k)
    return out


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
    ("S06", c(conflict=1, claim=1, create=10, extra=1)),   # the conflict row, its pick, its loser
    ("S07", c(conflict=1, claim=1, create=10, extra=1)),
    ("S08", c(conflict=1, claim=1, create=10, extra=2)),
    ("S09", c(conflict=1, claim=1, create=10, extra=1)),
    ("S10", c(conflict=1, claim=7, create=4, extra=4)),
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
        assert e["edges"]["counts"] == edge_counts(same=2, replaced=1, added=2)
        assert e["fields"] == [{"task": "Animation@Animation", "field": "duration", "current": 2400,
                                "template": 3360, "kind": "overwrite"}]


def test_bulk_variants():
    ents = PLAN["expectations"]["BULK"]["entities"]
    assert len(ents) == 30
    for n in range(1, 31):
        code = f"tts_bulk_{n:03d}"
        if n in (3, 13, 23):
            assert ents[code]["counts"] == c(conflict=1, claim=7, create=4, extra=4)
            assert ents[code]["conflicts"][0]["prepick"] == ["hand:comp @Comp"]
            assert ents[code]["conflicts"][0]["reason"] == "oldest"
        elif n in (7, 14, 21, 28):
            assert ents[code]["counts"] == c(claim=7, create=4, extra=4)
        else:
            assert ents[code]["counts"] == c(claim=7, create=4, extra=3)
    lighting = {x["task"]: x for x in ents["tts_bulk_011"]["extras"]}["Lighting@Light"]
    assert (lighting["versions"], lighting["pfs"]) == (1, 0)


# -- conflicts ------------------------------------------------------------------------------------

@pytest.mark.parametrize("sid,pick,reason,n", [
    ("S06", "hand:Comp#2", "usage", 2),
    ("S07", "hand:Comp#2", "status", 2),
    ("S08", "hand:Comp#2", "oldest", 3),
    ("S09", "hand:Comp#2", "usage", 2),
    ("S10", "hand:comp @Comp", "status", 2),
])
def test_prepick(sid, pick, reason, n):
    cf = entity(sid)["conflicts"]
    assert len(cf) == 1
    assert (cf[0]["prepick"], cf[0]["reason"], len(cf[0]["candidates"])) == ([pick], reason, n)


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
    assert out["counts"] == c(conflict=1, claim=1, create=1)
    assert out["conflicts"][0]["template_tasks"] == ["Comp@Comp", "comp @Comp"]


# -- renames, edges, fields -------------------------------------------------------------------------

def test_s02_renames():
    """The server trims `content` on create (seen by the seed on the sandbox, 2026-09-24): `Comp ` is
    stored `Comp` and is no rename; the inner double space survives."""
    assert entity("S02")["renames"] == [
        {"task": "hand:LAYOUT", "from": "LAYOUT", "to": "Layout", "hand_renamed": False},
        {"task": "hand:animation", "from": "animation", "to": "Animation", "hand_renamed": False},
        {"task": "hand:CLEANUP", "from": "CLEANUP", "to": "Cleanup", "hand_renamed": False},
        {"task": "hand:Client Review", "from": "Client  Review", "to": "Client Review", "hand_renamed": False},
    ]


def test_s10_prepicked_hand_task_is_renamed():
    assert entity("S10")["renames"] == [{"task": "hand:comp @Comp", "from": "comp", "to": "Comp", "hand_renamed": False}]


def test_s13_cascade_dates_downstream_of_the_dated_roots():
    tasks = {t["label"]: t for t in _plan.seeded_tasks(PLAN["scenarios"][12]["entities"][0], PLAN["templates"])}
    dated = sorted(k for k, t in tasks.items() if t["dated"])
    assert dated == ["Animation@Animation", "Client Review@Comp", "Comp@Comp", "FX@FX", "Layout@Layout",
                     "Lighting@Light", "Tracking@Tracking"]


def test_s01_hand_edge_is_replaced():
    e = entity("S01")["edges"]
    assert e["counts"] == edge_counts(replaced=1, added=10)
    assert e["replaced"] == [{"up": "Layout@Layout", "down": "Animation@Animation",
                              "from": ["start-to-start", None], "to": ["finish-to-start-next-day", None],
                              "action": "keep"}]


def test_s04_edges():
    e = entity("S04")["edges"]
    assert e["counts"] == edge_counts(same=2, replaced=2, removed=1, outside_upstream=2, kept=2, added=7)
    assert e["removed"] == [{"up": "Tracking@Tracking", "down": "Animation@Animation",
                             "type": "finish-to-start-next-day", "offset": None, "action": "keep"}]
    # 109: T1's Lighting and Paint@Comp are extras upstream of the claimed Comp: erased, kept by default
    assert [(x["up"], x["down"], x["action"]) for x in e["outside_upstream"]] == [
        ("Lighting@Light", "Comp@Comp", "keep"), ("Paint@Comp", "Comp@Comp", "keep")]
    assert [(x["up"], x["down"]) for x in e["kept"]] == [
        ("Animation@Animation", "Lighting@Light"), ("FX@FX", "Lighting@Light")]


def test_s10_edges_on_the_losing_candidate():
    """106: T1's Comp loses the conflict and is outside T2: its edge down to the claimed Client Review is
    erased (109), the claimed Roto's edge down to it is kept, Lighting and Paint to it are untouched."""
    e = entity("S10")["edges"]
    assert e["counts"] == edge_counts(same=1, replaced=1, removed=1, outside_upstream=1, kept=3, untouched=2,
                                      added=9)
    assert [(x["up"], x["down"]) for x in e["outside_upstream"]] == [("Comp@Comp", "Client Review@Comp")]
    assert sorted((x["up"], x["down"]) for x in e["untouched"]) == [("Lighting@Light", "Comp@Comp"),
                                                                     ("Paint@Comp", "Comp@Comp")]


def test_s15_s17_edges():
    assert entity("S15")["edges"]["counts"] == edge_counts(same=10, added=1)
    assert entity("S17")["edges"]["counts"] == edge_counts(added=3)


def test_no_seeded_edge_closes_a_loop():
    """No scenario seeds the loop case (085, 107); the unit test above covers the rule."""
    assert all(e["edges"]["counts"]["closes_loop"] == 0
               for s in PLAN["expectations"].values() for e in s["entities"].values())


T1_T2_FIELDS = [
    ("Layout@Layout", "duration", 960, 1440, "overwrite"),
    ("Layout@Layout", "sg_description", "Camera and blocking", "Camera, blocking and set dressing", "overwrite"),
    ("Animation@Animation", "est_in_mins", 1800, 2400, "overwrite"),
    ("Animation@Animation", "sg_description", "Body and face", "Body, face and cloth", "overwrite"),
    ("FX@FX", "sg_sort_order", 40, 45, "overwrite"),
]


def fields(sid):
    return [(f["task"], f["field"], f["current"], f["template"], f["kind"]) for f in entity(sid)["fields"]]


def test_s04_fields():
    assert fields("S04") == T1_T2_FIELDS


def test_s12_same_fields_as_s04():
    """task_assignees is not under policy (102): S12's assigned Animation changes nothing here."""
    assert fields("S12") == T1_T2_FIELDS


def test_s13_dated_layout_keeps_duration():
    assert fields("S13") == [f for f in T1_T2_FIELDS if f[:2] != ("Layout@Layout", "duration")]


def test_s14_fields():
    assert fields("S14") == [
        ("Layout@Layout", "duration", 1920, 1440, "overwrite"),
        ("Layout@Layout", "sg_description", None, "Camera, blocking and set dressing", "fill"),
        ("Animation@Animation", "est_in_mins", None, 2400, "fill"),
        ("Animation@Animation", "sg_description", "Studio note: keep", "Body, face and cloth", "overwrite"),
        ("FX@FX", "sg_sort_order", 99, 45, "overwrite"),
        ("Comp@Comp", "sg_description", None, "Final comp", "fill"),   # "" is stored null
        ("Client Review@Comp", "milestone", False, True, "overwrite"),
    ]


def test_s02_milestone_claim_gets_duration_zero():
    """083: T2's Client Review reads duration 0; 108: 0 is a value, so the undated hand Task takes it."""
    cr = [f for f in fields("S02") if f[0] == "hand:Client Review"]
    assert cr == [("hand:Client Review", "sg_sort_order", None, 90, "fill"),
                  ("hand:Client Review", "duration", None, 0, "fill"),
                  ("hand:Client Review", "milestone", False, True, "overwrite")]


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


# -- rules from probe rounds 2 and 3 (sg-groundtruth #81, #83), as the app's planner has them ------

def T(label, content, step="Comp", tpl=None, status=None, created_at=None, versions=0, pfs=0, **f):
    t = {"label": label, "content": content, "step": [step, "Shot"] if step else None, "template_task": tpl,
         "status": status, "created_at": created_at, "versions": versions, "pfs": pfs, "dated": False}
    t.update(f)
    return t


def tpl(*tasks, edges=()):
    return {"code": "x", "entity_type": "Shot", "tasks": list(tasks), "edges": list(edges)}


def test_conflict_counts_its_row_the_pick_and_the_losers():
    """planner.ts: counts are rows by kind; a conflict row sits next to the keep/claim/create its
    pre-pick resolves to, and the candidates not picked are extras (`conflict_loser`)."""
    out = _plan.expect("X", tpl(_plan.tt("Comp", "Comp", sort=10)),
                       [T("a", "Comp", created_at="2026-01-01"), T("b", "Comp", created_at="2026-02-01")],
                       [], entity_type="Shot", on_template=None)
    assert out["counts"] == c(claim=1, extra=1, conflict=1)
    assert out["conflicts"] == [{"template_tasks": ["Comp@Comp"], "candidates": ["a", "b"], "prepick": ["a"],
                                 "reason": "oldest"}]
    assert out["extras"] == [{"task": "b", "reason": "conflict_loser", "versions": 0, "pfs": 0, "status": None}]


def test_prepick_counts_usage_as_yes_or_no():
    """matching.ts: usage ranks by having any Version or PublishedFile, not by how many."""
    out = _plan.expect("X", tpl(_plan.tt("Comp", "Comp", sort=10)),
                       [T("a", "Comp", created_at="2026-01-01", versions=1),
                        T("b", "Comp", created_at="2026-02-01", versions=3)],
                       [], entity_type="Shot", on_template=None)
    assert (out["conflicts"][0]["prepick"], out["conflicts"][0]["reason"]) == (["a"], "oldest")


def test_template_with_two_tasks_of_one_key_pairs_candidates_in_template_order():
    out = _plan.expect("X", tpl(_plan.tt("Comp", "Comp", sort=10), _plan.tt("comp ", "Comp", sort=20)),
                       [T("a", "Comp", created_at="2026-01-01")], [], entity_type="Shot", on_template=None)
    assert out["counts"] == c(claim=1, create=1, conflict=1)
    assert out["conflicts"][0]["template_tasks"] == ["Comp@Comp", "comp @Comp"]


def test_zero_on_the_template_is_a_value():
    """108: a numeric 0 on T's task overwrites."""
    out = _plan.expect("X", tpl(_plan.tt("Comp", "Comp", sort=10, est=0)),
                       [T("a", "Comp", est_in_mins=60, sg_sort_order=10)], [], entity_type="Shot", on_template=None)
    assert [(f["field"], f["current"], f["template"]) for f in out["fields"]] == [("est_in_mins", 60, 0)]


def test_milestone_template_reads_duration_zero():
    """083: a milestone reads duration 0; 108: 0 is a value, so an undated hand Task gets it."""
    out = _plan.expect("X", tpl(_plan.tt("Client Review", "Comp", sort=90, milestone=True)),
                       [T("a", "Client Review", sg_sort_order=90, milestone=False)], [], entity_type="Shot",
                       on_template=None)
    assert [(f["field"], f["current"], f["template"]) for f in out["fields"]] == [
        ("duration", None, 0), ("milestone", False, True)]


def test_assignees_are_not_under_policy():
    """102: task_assignees is only filled when empty, by the server: no policy, not listed."""
    out = _plan.expect("X", tpl(_plan.tt("Comp", "Comp", sort=10, assignees=["artist2"])),
                       [T("a", "Comp", sg_sort_order=10, task_assignees=[])], [], entity_type="Shot",
                       on_template=None)
    assert out["fields"] == []


def test_duration_skipped_on_a_task_with_one_date():
    """108: either date set keeps the Task's duration."""
    out = _plan.expect("X", tpl(_plan.tt("Comp", "Comp", sort=10, duration=960)),
                       [T("a", "Comp", sg_sort_order=10, dated=True)], [], entity_type="Shot", on_template=None)
    assert out["fields"] == []


def edges_of(template, tasks, edges):
    return _plan.expect("X", template, tasks, edges, entity_type="Shot", on_template=None)["edges"]


def test_outside_upstream_edge_is_erased_and_kept_by_default():
    """109: a linked Task depending on a Task not linked to T loses the edge; keep re-creates it."""
    e = edges_of(tpl(_plan.tt("Comp", "Comp", sort=10)), [T("a", "Comp"), T("x", "Paint")],
                 [_plan.edge("x", "a")])
    assert e["outside_upstream"] == [{"up": "x", "down": "Comp@Comp", "type": "finish-to-start-next-day",
                                      "offset": None, "action": "keep"}]
    assert e["kept"] == []


def test_outside_downstream_edge_is_kept():
    e = edges_of(tpl(_plan.tt("Comp", "Comp", sort=10)), [T("a", "Comp"), T("x", "Paint")],
                 [_plan.edge("a", "x")])
    assert e["kept"] == [{"up": "Comp@Comp", "down": "x", "type": "finish-to-start-next-day", "offset": None}]
    assert e["outside_upstream"] == []


def test_edge_with_no_linked_end_is_untouched():
    e = edges_of(tpl(_plan.tt("Comp", "Comp", sort=10)), [T("x", "Paint"), T("y", "Roto")],
                 [_plan.edge("x", "y")])
    assert e["untouched"] == [{"up": "x", "down": "y", "type": "finish-to-start-next-day", "offset": None}]
    assert e["kept"] == []


def test_conflict_loser_is_an_outside_task_for_edges():
    """106: losers are unlinked before the template write, so their edges follow 109."""
    e = edges_of(tpl(_plan.tt("Comp", "Comp", sort=10), _plan.tt("Roto", "Roto", sort=20)),
                 [T("a", "Comp", created_at="2026-01-01"), T("b", "Comp", created_at="2026-02-01"),
                  T("r", "Roto", step="Roto")],
                 [_plan.edge("b", "r")])
    assert [x["up"] for x in e["outside_upstream"]] == ["b"]


def test_offset_null_and_zero_differ():
    """105: null and 0 are different edges to the server."""
    t = tpl(_plan.tt("Roto", "Roto", sort=10), _plan.tt("Comp", "Comp", sort=20),
            edges=[_plan.edge("Roto@Roto", "Comp@Comp", offset=0)])
    e = edges_of(t, [T("r", "Roto", step="Roto"), T("a", "Comp")], [_plan.edge("r", "a")])
    assert e["counts"]["replaced"] == 1 and e["counts"]["same"] == 0


def test_kept_edge_closing_a_loop_defaults_to_remove():
    """085, 107: re-creating an edge that closes a loop is a 400 that rolls the batch back."""
    t = tpl(_plan.tt("A", "Comp", sort=10), _plan.tt("B", "Comp", sort=20), _plan.tt("C", "Comp", sort=30),
            edges=[_plan.edge("A@Comp", "B@Comp"), _plan.edge("B@Comp", "C@Comp")])
    e = edges_of(t, [T("a", "A"), T("b", "B"), T("cc", "C")],
                 [_plan.edge("a", "b"), _plan.edge("cc", "a")])    # the apply adds B -> C
    assert e["removed"] == [{"up": "C@Comp", "down": "A@Comp", "type": "finish-to-start-next-day", "offset": None,
                             "action": "remove", "closes_loop": True}]


def test_renames_flag_hand_renamed_linked_tasks():
    out = _plan.expect("X", tpl(_plan.tt("Comp", "Comp", sort=10)),
                       [T("a", "Final", tpl=["X", "Comp@Comp"], sg_sort_order=10)], [], entity_type="Shot",
                       on_template=None)
    assert out["renames"] == [{"task": "a", "from": "Final", "to": "Comp", "hand_renamed": True}]


def test_expectations_file_carries_the_seed_spec():
    """The vitest (src/lib/pure/seed.test.ts) rebuilds template rows and hand created_at from it."""
    f = _plan.expectations_file(PLAN, "Sequence")
    assert set(f) >= {"about", "custom_type", "filters", "default_task_template", "templates", "hands", "scenarios"}
    assert [x["label"] for x in f["templates"]["T3"]["tasks"]][0] == "Previs@Layout"
    assert f["hands"]["S06"]["tts_cf_pubs"]["hand:Comp#1"] == {"step": ["Comp", "Shot"],
                                                             "created_at": "2026-01-05T09:00:00Z"}
