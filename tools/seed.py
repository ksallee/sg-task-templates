"""Seed the task-template scenarios into the sandbox project, through the real API.

    uv run --with requests python tools/seed.py                     # dry run: resolve, plan, state
    uv run --with requests python tools/seed.py --write             # create what is missing
    uv run --with requests python tools/seed.py --reset S04,S13,BULK   # delete and recreate those
    uv run --with requests python tools/seed.py --reset all [--reset-templates]
    uv run --with requests python tools/seed.py --clean             # delete every seeded row
    uv run --with requests python tools/seed.py --expectations      # rewrite the expectations file only

`tools/_plan.py` holds the content (templates T1-T6, scenarios S01-S22 and BULK) and the plan the app
must show on each scenario; this file only executes it. After sg-notes' tools/seed.py.

Only the project named by FPT_PROBE_SANDBOX_PROJECT (sg-groundtruth/.env.local) is written, and only
rows whose code starts `tts_`, the TTS_* Sequences and the `TT Seed · ` templates. Kevin keeps the data:
nothing is deleted unless `--reset` or `--clean` says so.

State per scenario, read on every run: missing (no entity of its codes), pristine (the read-back equals
the manifest's snapshot), drifted (the app or a person changed it: reported, never touched), orphan
(an entity of that code the manifest does not own: reported, never touched). `--write` creates missing
scenarios only; `--reset` deletes a scenario's Tasks, PublishedFiles, Versions and entities, then
recreates it. S22 and T3 go together: T3 is edited after S22's Shots exist, so recreating S22 recreates
T3 as well.

Where the corpus is silent (seed-scenario design, Q2-Q12), the safe path:
- Q6  template tasks: one `POST /entity/tasks` each (measured, TaskTemplate card), never `_batch` (a
      project-less batch create is report 001's unreadable row). Templates themselves: one POST each too.
- Q7  `tracking_settings` is read, printed and stored in the manifest, never written: the write is
      unmeasured. Kevin sets Shot = T2 and Asset = T4 in the project's Tracking Settings (S19-S21).
- Q8  T6/S18 use a Sequence (in `Task.entity` valid_types) when Sequence has `task_template`, not a
      custom entity: `Task.entity` on a custom type is unmeasured. Custom types that have the field are
      listed. Without the field on Sequence, T6 and S18 are skipped.
- Q10 reset deletes Tasks, PublishedFiles and Versions explicitly before the entity (060 covers only
      Versions; 089 says a Task delete retires its edges).
- Q12 S05's `template_task` is written by a `_batch` update, the call recipe 015 measured, not in the
      create body.
- Q4/Q5/Q9 S13 writes its dates one PUT at a time and records what the server did (dates, `pinned`,
      `dependency_violation`) instead of predicting it. Q2, Q3, Q11 concern the apply, not the seed.
- PublishedFile `created_at` is not sent: 070 measured it on Note, Reply, Task and Version only.
- Q1 is answered by probe 101 (a template edge replaces the pair's other edge); the expectations use it.
"""
import argparse
import datetime as dt
import sys
import time

import _plan
import _site

PREFIX = "tts_"
TEMPLATE_PREFIX = "TT Seed · "
SECOND_ARTIST_NAME = "Other Artist"
VERSION_AT = "2026-07-01T09:00:00Z"
SLUG = {"Shot": "shots", "Asset": "assets", "Sequence": "sequences"}
TASK_FIELDS = ["content", "step", "entity", "template_task", "sg_status_list", "start_date", "due_date",
               "pinned", "dependency_violation", "duration", "est_in_mins", "sg_description",
               "sg_sort_order", "milestone", "task_assignees", "task_reviewers"]
TEMPLATE_TASK_FIELDS = ["content", "step", "task_template", "sg_sort_order", "duration", "est_in_mins",
                        "sg_description", "milestone", "task_assignees", "start_date", "due_date"]
EDGE_FIELDS = ["task", "dependent_task", "dependency_type", "offset_days"]


def slug(entity_type):
    return SLUG.get(entity_type) or entity_type


class Seed:
    def __init__(self, e, artist2=""):
        t0 = time.time()
        self.c = _site.client(e)
        self.project = _site.project_id(self.c, e)
        self.P = {"type": "Project", "id": self.project}
        self.m = _site.read_json(_site.MANIFEST) or {}
        if self.m and self.m.get("project") != self.project:
            raise SystemExit(f"the manifest is for project {self.m.get('project')}, the env names {self.project}")
        self.m.setdefault("project", self.project)
        self.m.setdefault("templates", {})
        self.m.setdefault("sequences", {})
        self.m.setdefault("scenarios", {})

        artist = (e.get("FPT_USER_LOGIN") or "").strip()
        if not artist:
            raise SystemExit("set FPT_USER_LOGIN in sg-groundtruth/.env.local")
        self.users = {"artist": self._user([["login", "is", artist]], artist),
                      "artist2": self._user([["login", "is", artist2]] if artist2 else
                                            [["name", "is", SECOND_ARTIST_NAME]], artist2 or SECOND_ARTIST_NAME)}
        self.steps, self.step_names = self._steps()
        self.default_status, self.usable = self._statuses()
        self.custom_type, self.custom_candidates = self._custom()
        self.plan = _plan.build(self.custom_type or _plan.CUSTOM_FALLBACK)
        self.tracking = self._tracking()
        self._check()
        self.resolve_s = time.time() - t0

    # -- resolution ---------------------------------------------------------------------------------

    def _user(self, filters, what):
        rows = _site.search_all(self.c, "human_users", filters, ["login", "name"])
        if len(rows) != 1:
            raise SystemExit(f"{len(rows)} HumanUsers match {what!r}: pass --artist2 LOGIN")
        return rows[0]["id"]

    def _steps(self):
        rows = _site.search_all(self.c, "steps", [], ["code", "entity_type"], sort="id")
        by, names = {}, {}
        for s in rows:
            key = (s["attributes"]["code"], s["attributes"]["entity_type"])
            by.setdefault(key, s["id"])     # lowest id wins where a site has duplicates
            names[s["id"]] = key[0]
        return by, names

    def _statuses(self):
        d = _site.ok(self.c.get("/schema/Task/fields/sg_status_list", params={"project_id": self.project}),
                     "schema Task.sg_status_list")
        props = d["properties"]

        def v(k):
            x = props.get(k)
            return x.get("value") if isinstance(x, dict) and "value" in x else x
        usable = [s for s in v("valid_values") or [] if s not in (v("hidden_values") or [])]
        return v("default_value"), usable

    def _has_field(self, entity_type, field):
        r = self.c.get(f"/schema/{entity_type}/fields/{field}", params={"project_id": self.project})
        return r.status_code == 200

    def _custom(self):
        types = _site.ok(self.c.get("/schema"), "schema")      # {type name: {name: {value}, ...}}
        custom = sorted(n for n in types if n.startswith("CustomEntity") and "_" not in n)
        with_field = [n for n in custom if self._has_field(n, "task_template")]
        return ("Sequence" if self._has_field("Sequence", "task_template") else None), with_field

    def _tracking(self):
        d = _site.ok(self.c.get(f"/entity/projects/{self.project}", params={"fields": "tracking_settings"}),
                     "project tracking_settings")
        return (d.get("attributes") or {}).get("tracking_settings")

    def _check(self):
        missing = [f"{n} ({t})" for n, t in _plan.needed_steps(self.plan) if (n, t) not in self.steps]
        if missing:
            raise SystemExit(f"Steps missing on this site: {', '.join(missing)}")
        bad = [s for s in _plan.needed_statuses(self.plan) if s not in self.usable]
        if bad:
            raise SystemExit(f"Task statuses not usable in the project: {bad}")
        if self.default_status in _plan.needed_statuses(self.plan):
            raise SystemExit(f"the project's default Task status is {self.default_status!r}, which the "
                             "scenarios use as a non-default status: the conflict pre-picks would not hold")

    def step_ref(self, step):
        return {"type": "Step", "id": self.steps[tuple(step)]} if step else None

    def people(self, roles):
        return [{"type": "HumanUser", "id": self.users[r]} for r in roles]

    def skipped(self, sid):
        return sid == "S18" and self.custom_type is None

    # -- templates ------------------------------------------------------------------------------------

    def spec(self, key, edited=None):
        t = self.plan["templates"][key]
        if key == "T3" and (edited if edited is not None else self.m["templates"].get("T3", {}).get("edited")):
            return _plan.edited_t3(t)
        return t

    def find_template(self, key):
        code = self.plan["templates"][key]["code"]
        mid = self.m["templates"].get(key, {}).get("id")
        if mid:
            rows = _site.search_all(self.c, "task_templates", [["id", "is", mid]], ["code", "entity_type"])
            if rows and rows[0]["attributes"]["code"] == code:
                return rows[0]["id"]
        rows = _site.search_all(self.c, "task_templates", [["code", "is", code]], ["code"])
        if len(rows) > 1:
            raise SystemExit(f"{len(rows)} TaskTemplates with code {code!r}: resolve by hand")
        return rows[0]["id"] if rows else None

    def read_template(self, tid):
        T = {"type": "TaskTemplate", "id": tid}
        tasks = _site.search_all(self.c, "tasks", [["task_template", "is", T]], TEMPLATE_TASK_FIELDS, sort="id")
        by = {}
        for t in tasks:
            a = t["attributes"]
            by[_plan.label(a["content"], [self.step_names.get(_site.rel_id(t, "step"))]
                           if _site.rel_id(t, "step") else None)] = t
        refs = [{"type": "Task", "id": t["id"]} for t in tasks]
        edges = _site.search_in(self.c, "task_dependencies", "task", refs, [], EDGE_FIELDS) if refs else []
        lab = {t["id"]: lbl for lbl, t in by.items()}
        eb = {}
        for e in edges:
            a = e["attributes"]
            eb[(lab.get(_site.rel_id(e, "dependent_task")), lab.get(_site.rel_id(e, "task")))] = \
                {"id": e["id"], "type": a["dependency_type"], "offset": a["offset_days"]}
        return by, eb

    def template_diff(self, key, tid, edited=None):
        """Differences between the site's template and the plan: (missing tasks, missing edges, drift)."""
        spec = self.spec(key, edited)
        by, eb = self.read_template(tid)
        drift = [f"extra task {x}" for x in by if x not in {t['label'] for t in spec["tasks"]}]
        miss_t = [x for x in spec["tasks"] if x["label"] not in by]
        for x in spec["tasks"]:
            t = by.get(x["label"])
            if not t:
                continue
            a = t["attributes"]
            for f in ("sg_sort_order", "est_in_mins", "sg_description", "milestone", "start_date", "due_date"):
                if x[f] not in (None, False) and a.get(f) != x[f]:
                    drift.append(f"{x['label']}.{f} {a.get(f)!r} != {x[f]!r}")
            if x["duration"] is not None and a.get("duration") != x["duration"]:
                drift.append(f"{x['label']}.duration {a.get('duration')!r} != {x['duration']!r}")
            want = sorted(self.users[r] for r in x["task_assignees"])
            have = sorted(p["id"] for p in _site.rel(t, "task_assignees") or [])
            if want != have:
                drift.append(f"{x['label']}.task_assignees {have} != {want}")
        miss_e = []
        for x in spec["edges"]:
            have = eb.get((x["up"], x["down"]))
            if not have:
                miss_e.append(x)
            elif (have["type"], have["offset"]) != (x["type"], x["offset"]):
                drift.append(f"edge {x['up']} -> {x['down']} {have['type']} {have['offset']}")
        extra_e = [k for k in eb if k not in {(x["up"], x["down"]) for x in spec["edges"]}]
        drift += [f"extra edge {a} -> {b}" for a, b in extra_e]
        return miss_t, miss_e, drift, by, eb

    def template_body(self, x, tid):
        body = {"content": x["content"], "task_template": {"type": "TaskTemplate", "id": tid}}
        if x["step"]:
            body["step"] = self.step_ref(x["step"])
        for f in ("sg_sort_order", "duration", "est_in_mins", "sg_description", "start_date", "due_date"):
            if x[f] is not None:
                body[f] = x[f]
        if x["milestone"]:
            body["milestone"] = True
        if x["task_assignees"]:
            body["task_assignees"] = self.people(x["task_assignees"])
        return body

    def ensure_template(self, key, fresh=False):
        spec = self.plan["templates"][key]
        tid = None if fresh else self.find_template(key)
        if tid is None:
            body = {"code": spec["code"], "entity_type": spec["entity_type"], "projects": [self.P]}
            tid = _site.ok(self.c.post("/entity/task_templates", headers=_site.JSON, json=body),
                           f"create template {key}")["id"]
            self.m["templates"][key] = {"id": tid, "code": spec["code"], "edited": False}
            print(f"  TaskTemplate {tid:>6}  {key} {spec['code']}")
        self.m["templates"].setdefault(key, {"id": tid, "code": spec["code"], "edited": False})["id"] = tid
        miss_t, miss_e, drift, by, _ = self.template_diff(key, tid)
        for x in miss_t:
            d = _site.ok(self.c.post("/entity/tasks", headers=_site.JSON, json=self.template_body(x, tid)),
                         f"create template task {key} {x['label']}")
            by[x["label"]] = {"id": d["id"]}
        if miss_t:
            print(f"    {len(miss_t)} template tasks")
        if miss_e:
            _site.batch(self.c, [self.edge_req(by[x["up"]]["id"], by[x["down"]]["id"], x) for x in miss_e],
                        f"template edges {key}")
            print(f"    {len(miss_e)} template edges")
        if drift:
            print(f"  ! {key} differs from the plan, left as is: {'; '.join(drift[:6])}")
        self.record_template(key, tid)
        return tid

    def record_template(self, key, tid):
        by, eb = self.read_template(tid)
        self.m["templates"][key].update({
            "tasks": {lbl: t["id"] for lbl, t in by.items()},
            "edges": {f"{a} > {b}": v["id"] for (a, b), v in eb.items()}})

    def edge_req(self, up_id, down_id, x):
        data = {"task": {"type": "Task", "id": down_id}, "dependent_task": {"type": "Task", "id": up_id},
                "dependency_type": x["type"]}
        if x["offset"] is not None:
            data["offset_days"] = x["offset"]
        return {"request_type": "create", "entity": "TaskDependency", "data": data}

    def edit_t3(self):
        """The T3 edit, after S22's Shots exist (085: a PUT on a template row; template rows are undated)."""
        tid = self.m["templates"]["T3"]["id"]
        ed = self.plan["t3_edit"]
        by, eb = self.read_template(tid)
        for x in ed["tasks"]:
            if x["label"] not in by:
                d = _site.ok(self.c.post("/entity/tasks", headers=_site.JSON, json=self.template_body(x, tid)),
                             f"T3 edit {x['label']}")
                by[x["label"]] = {"id": d["id"]}
        for lbl, patch in ed["update_tasks"].items():
            _site.ok(self.c.put(f"/entity/tasks/{by[lbl]['id']}", headers=_site.JSON, json=patch), f"T3 edit {lbl}")
        new = [x for x in ed["edges"] if (x["up"], x["down"]) not in eb]
        if new:
            _site.batch(self.c, [self.edge_req(by[x["up"]]["id"], by[x["down"]]["id"], x) for x in new], "T3 edges")
        for u in ed["update_edges"]:
            e = eb[(u["up"], u["down"])]
            _site.ok(self.c.put(f"/entity/task_dependencies/{e['id']}", headers=_site.JSON, json=u["set"]),
                     f"T3 edit edge {u['up']} > {u['down']}")
        self.m["templates"]["T3"]["edited"] = True
        self.record_template("T3", tid)
        print("  T3 edited: + Previs, Animation 3360, Light > Comp +1, Layout SS> Light")

    def delete_template(self, key):
        tid = self.find_template(key)
        if tid:
            r = self.c.delete(f"/entity/task_templates/{tid}")
            if r.status_code != 204:
                raise SystemExit(f"delete template {key} {tid} -> {r.status_code} {r.text[:300]}")
            print(f"  deleted TaskTemplate {tid} {key} (its tasks retire with it)")
        self.m["templates"].pop(key, None)

    # -- scenarios: reading -----------------------------------------------------------------------------

    def find_entities(self, sc):
        et = sc["entity_type"]
        codes = [e["code"] for e in sc["entities"]]
        rows = []
        for i in range(0, len(codes), 100):
            rows += _site.search_all(self.c, slug(et), [["project", "is", self.P], ["code", "in", codes[i:i + 100]]],
                                     ["code", "task_template"])
        return rows

    def snapshot(self, et, refs):
        """What the pristine check compares: every Task on the entities, their edges, publishes."""
        tasks = _site.search_in(self.c, "tasks", "entity", refs, [], TASK_FIELDS)
        trefs = [{"type": "Task", "id": t["id"]} for t in tasks]
        edges = _site.search_in(self.c, "task_dependencies", "task", trefs, [], EDGE_FIELDS) if trefs else []
        vers = _site.search_in(self.c, "versions", "entity", refs, [], ["code", "sg_task", "entity"])
        pfs = _site.search_in(self.c, "published_files", "entity", refs, [], ["code", "task", "entity"])
        out = {str(r["id"]): {"task_template": None, "tasks": {}, "edges": [], "versions": [], "pfs": []}
               for r in refs}
        for r in _site.search_all(self.c, slug(et), [["id", "in", [r["id"] for r in refs]]], ["task_template"]):
            out[str(r["id"])]["task_template"] = _site.rel_id(r, "task_template")
        owner = {}
        for t in tasks:
            a = t["attributes"]
            eid = str(_site.rel_id(t, "entity"))
            owner[t["id"]] = eid
            out[eid]["tasks"][str(t["id"])] = {
                "content": a["content"], "step": _site.rel_id(t, "step"),
                "template_task": _site.rel_id(t, "template_task"), "status": a["sg_status_list"],
                "start_date": a["start_date"], "due_date": a["due_date"], "pinned": a["pinned"],
                "dependency_violation": a["dependency_violation"], "duration": a["duration"],
                "est_in_mins": a["est_in_mins"], "sg_description": a["sg_description"],
                "sg_sort_order": a["sg_sort_order"], "milestone": a["milestone"],
                "task_assignees": sorted(p["id"] for p in _site.rel(t, "task_assignees") or []),
                "task_reviewers": sorted(p["id"] for p in _site.rel(t, "task_reviewers") or [])}
        for e in edges:
            a = e["attributes"]
            down = _site.rel_id(e, "task")
            out[owner[down]]["edges"].append([_site.rel_id(e, "dependent_task"), down, a["dependency_type"],
                                              a["offset_days"]])
        for v in vers:
            out[str(_site.rel_id(v, "entity"))]["versions"].append([v["id"], _site.rel_id(v, "sg_task")])
        for p in pfs:
            out[str(_site.rel_id(p, "entity"))]["pfs"].append([p["id"], _site.rel_id(p, "task")])
        for s in out.values():
            s["edges"].sort()
            s["versions"].sort()
            s["pfs"].sort()
        return out

    def state(self, sc):
        if self.skipped(sc["id"]):
            return "skipped", []
        rows = self.find_entities(sc)
        mine = self.m["scenarios"].get(sc["id"])
        if not rows:
            return "missing", rows
        ids = {e["code"]: e["id"] for e in (mine or {}).get("entities", {}).values()} if mine else {}
        if not mine or {r["attributes"]["code"]: r["id"] for r in rows} != ids or len(rows) != len(sc["entities"]):
            return "orphan", rows
        snap = self.snapshot(sc["entity_type"], [{"type": sc["entity_type"], "id": r["id"]} for r in rows])
        return ("pristine" if snap == mine["snapshot"] else "drifted"), rows

    def drift_detail(self, sc):
        """The drift lines for a scenario: every drifted entity, from _plan.drift_report."""
        mine = self.m["scenarios"][sc["id"]]
        refs = [{"type": sc["entity_type"], "id": e["id"]} for e in mine["entities"].values()]
        now = self.snapshot(sc["entity_type"], refs)
        codes = {str(e["id"]): e["code"] for e in mine["entities"].values()}
        return _plan.drift_report(mine["snapshot"], now, codes)

    # -- scenarios: writing -----------------------------------------------------------------------------

    def create_scenario(self, sc, tids):
        et = sc["entity_type"]
        t0 = time.time()
        # entities, the templated ones with task_template (083), chunks of 10
        reqs = []
        for e in sc["entities"]:
            data = {"project": self.P, "code": e["code"]}
            if et == "Shot":
                data["sg_sequence"] = {"type": "Sequence", "id": self.m["sequences"][sc["sequence"]]}
            if e["created_with"]:
                data["task_template"] = {"type": "TaskTemplate", "id": tids[e["created_with"]]}
            reqs.append({"request_type": "create", "entity": et, "data": data})
        ids = []
        for i in range(0, len(reqs), 10):
            ids += [_site.row_id(r) for r in _site.batch(self.c, reqs[i:i + 10], f"{sc['id']} entities")]
        rec = {e["code"]: {"type": et, "id": i, "code": e["code"], "tasks": {}, "versions": {}, "pfs": {}}
               for e, i in zip(sc["entities"], ids)}
        self.m["scenarios"][sc["id"]] = {"entities": rec, "snapshot": None}
        refs = [{"type": et, "id": i} for i in ids]

        # generated Tasks, read back (083: the 201 body lists none)
        gen = _site.search_in(self.c, "tasks", "entity", refs, [], ["content", "step", "entity", "template_task"])
        by_ent = {i: [] for i in ids}
        for t in gen:
            by_ent[_site.rel_id(t, "entity")].append(t)
        for e in sc["entities"]:
            r = rec[e["code"]]
            for t in by_ent[r["id"]]:
                st = _site.rel_id(t, "step")
                r["tasks"][_plan.label(t["attributes"]["content"], [self.step_names[st]] if st else None)] = t["id"]
            want = {x["label"] for x in self.plan["templates"][e["created_with"]]["tasks"]} if e["created_with"] else set()
            if set(r["tasks"]) != want:
                raise SystemExit(f"{e['code']}: generated {sorted(r['tasks'])}, the plan says {sorted(want)}")

        # hand-made Tasks, always with project (report 001), created_at on create (070)
        reqs, keys = [], []
        for e in sc["entities"]:
            r = rec[e["code"]]
            for h in e["hand"]:
                data = {"project": self.P, "entity": {"type": et, "id": r["id"]}, "content": h["content"],
                        "created_at": h["created_at"]}
                if h["step"]:
                    data["step"] = self.step_ref(h["step"])
                if h["status"]:
                    data["sg_status_list"] = h["status"]
                reqs.append({"request_type": "create", "entity": "Task", "data": data})
                keys.append((e["code"], h["label"]))
        if reqs:
            for (code, lbl), row in zip(keys, _site.batch(self.c, reqs, f"{sc['id']} hand tasks")):
                rec[code]["tasks"][lbl] = _site.row_id(row)

        # hand edges (086: a second call after the Tasks) and S05's template_task (recipe 015)
        reqs = []
        for e in sc["entities"]:
            T = rec[e["code"]]["tasks"]
            reqs += [self.edge_req(T[x["up"]], T[x["down"]], x) for x in e["edges"]]
            for lbl, tkey, tlabel in e["links"]:
                reqs.append({"request_type": "update", "entity": "Task", "record_id": T[lbl],
                             "data": {"template_task": {"type": "Task",
                                                        "id": self.m["templates"][tkey]["tasks"][tlabel]}}})
        if reqs:
            _site.batch(self.c, reqs, f"{sc['id']} edges and links")

        # mutations: statuses, people, fields; S15's delete
        reqs = []
        for e in sc["entities"]:
            T = rec[e["code"]]["tasks"]
            for lbl, patch in e["updates"].items():
                data = {k: (self.people(v) if k in ("task_assignees", "task_reviewers") else v)
                        for k, v in patch.items()}
                reqs.append({"request_type": "update", "entity": "Task", "record_id": T[lbl], "data": data})
            for lbl in e["deletes"]:
                reqs.append({"request_type": "delete", "entity": "Task", "record_id": T.pop(lbl)})
        if reqs:
            _site.batch(self.c, reqs, f"{sc['id']} mutations")

        # Versions, then PublishedFiles, with project, no path
        for kind, entity, field in (("versions", "Version", "sg_task"), ("pfs", "PublishedFile", "task")):
            reqs, keys = [], []
            for e in sc["entities"]:
                r = rec[e["code"]]
                for lbl, n in e[kind].items():
                    for k in range(1, n + 1):
                        name = f"{e['code']}_{lbl.replace('hand:', 'h_').replace('@', '_').replace('#', '')}"
                        data = {"project": self.P, "entity": {"type": et, "id": r["id"]},
                                field: {"type": "Task", "id": r["tasks"][lbl]}}
                        if entity == "Version":
                            data.update({"code": f"{name}_v{k:03d}", "created_at": VERSION_AT})
                        else:
                            data.update({"code": f"{name}.v{k:03d}.exr", "name": f"{name}.exr", "version_number": k})
                        reqs.append({"request_type": "create", "entity": entity, "data": data})
                        keys.append((e["code"], lbl))
            if reqs:
                for (code, lbl), row in zip(keys, _site.batch(self.c, reqs, f"{sc['id']} {kind}")):
                    rec[code][kind].setdefault(lbl, []).append(_site.row_id(row))

        # S13 dates: one PUT each, in order (087)
        for e in sc["entities"]:
            T = rec[e["code"]]["tasks"]
            for lbl, patch in e["dates"]:
                _site.ok(self.c.put(f"/entity/tasks/{T[lbl]}", headers=_site.JSON, json=patch),
                         f"{e['code']} dates {lbl}")

        n = sum(len(r["tasks"]) for r in rec.values())
        print(f"  {sc['id']:<5} {len(ids)} {et}(s), {n} Tasks  {time.time() - t0:.1f}s")

    def finish_scenario(self, sc):
        s = self.m["scenarios"][sc["id"]]
        refs = [{"type": sc["entity_type"], "id": e["id"]} for e in s["entities"].values()]
        s["snapshot"] = self.snapshot(sc["entity_type"], refs)
        s["seeded_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    def delete_scenario(self, sc, rows):
        et = sc["entity_type"]
        rows = [r for r in rows if r["attributes"]["code"].startswith(PREFIX)]
        if not rows:
            self.m["scenarios"].pop(sc["id"], None)
            return
        refs = [{"type": et, "id": r["id"]} for r in rows]
        extra = [["project", "is", self.P]]
        pfs = _site.search_in(self.c, "published_files", "entity", refs, extra, ["code"])
        vers = _site.search_in(self.c, "versions", "entity", refs, extra, ["code"])
        tasks = _site.search_in(self.c, "tasks", "entity", refs, extra, ["content"])
        reqs = [{"request_type": "delete", "entity": "PublishedFile", "record_id": x["id"]} for x in pfs]
        reqs += [{"request_type": "delete", "entity": "Version", "record_id": x["id"]} for x in vers]
        reqs += [{"request_type": "delete", "entity": "Task", "record_id": x["id"]} for x in tasks]
        if reqs:
            _site.batch(self.c, reqs, f"{sc['id']} delete rows")
        _site.batch(self.c, [{"request_type": "delete", "entity": et, "record_id": r["id"]} for r in rows],
                    f"{sc['id']} delete entities")
        print(f"  {sc['id']:<5} deleted {len(rows)} {et}(s), {len(tasks)} Tasks, {len(vers)} Versions, {len(pfs)} PFs")
        self.m["scenarios"].pop(sc["id"], None)

    # -- sequences ------------------------------------------------------------------------------------------

    def sequences(self, write):
        rows = _site.search_all(self.c, "sequences", [["project", "is", self.P], ["code", "in", _plan.SEQUENCES]],
                                ["code"])
        have = {}
        for r in rows:
            have.setdefault(r["attributes"]["code"], r["id"])
        miss = [s for s in _plan.SEQUENCES if s not in have]
        if miss and write:
            out = _site.batch(self.c, [{"request_type": "create", "entity": "Sequence",
                                        "data": {"project": self.P, "code": s}} for s in miss], "sequences")
            for s, row in zip(miss, out):
                have[s] = _site.row_id(row)
            print(f"  Sequences {', '.join(miss)}")
        self.m["sequences"] = have
        return miss


def write_expectations(plan, custom_type):
    _site.write_json(_site.EXPECTATIONS, _plan.expectations_file(plan, custom_type))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true", help="create what is missing")
    ap.add_argument("--reset", default="", metavar="IDS", help="comma-separated scenario ids, or 'all'")
    ap.add_argument("--reset-templates", action="store_true", help="with --reset all: recreate T1-T6 too")
    ap.add_argument("--clean", action="store_true", help="delete every seeded row and the manifest")
    ap.add_argument("--expectations", action="store_true", help="rewrite fixtures/seed-expectations.json only")
    ap.add_argument("--artist2", default="", metavar="LOGIN",
                    help=f"second person's login; default the HumanUser named {SECOND_ARTIST_NAME!r}")
    a = ap.parse_args()
    if a.expectations:
        plan = _plan.build()
        write_expectations(plan, _plan.CUSTOM_FALLBACK)
        print(f"wrote {_site.EXPECTATIONS}")
        return
    t0 = time.time()
    s = Seed(_site.env(), a.artist2)
    ids = [sc["id"] for sc in s.plan["scenarios"]]
    reset = ids if a.reset == "all" else [x.strip() for x in a.reset.split(",") if x.strip()]
    unknown = [x for x in reset if x not in ids]
    if unknown:
        raise SystemExit(f"unknown scenario ids: {unknown}")
    if a.reset_templates and a.reset != "all":
        raise SystemExit("--reset-templates needs --reset all: every scenario points at the templates")
    write = a.write or bool(reset) or a.clean

    print(f"project {s.project}  (resolved in {s.resolve_s:.1f}s)")
    print(f"  artist HumanUser {s.users['artist']}, artist2 HumanUser {s.users['artist2']}")
    print(f"  Task statuses usable: {', '.join(s.usable)}; default {s.default_status!r}")
    print(f"  Steps: {', '.join(f'{n}/{t}={s.steps[(n, t)]}' for n, t in _plan.needed_steps(s.plan))}")
    print(f"  T6/S18 type: {s.custom_type or 'none (Sequence has no task_template): skipped'}; "
          f"custom types with task_template: {', '.join(s.custom_candidates) or 'none'}")
    dtt = (s.tracking or {}).get("default_task_template") if isinstance(s.tracking, dict) else None
    print(f"  tracking_settings.default_task_template now: {dtt!r} (never written, Q7)")
    print("\n" + _plan.summary(s.plan))

    if a.clean:
        for sc in s.plan["scenarios"]:
            s.delete_scenario(sc, s.find_entities(sc))
        for code, i in list(s.m["sequences"].items()):
            if code in _plan.SEQUENCES:
                s.c.delete(f"/entity/sequences/{i}")
        for key in reversed(list(s.plan["templates"])):
            s.delete_template(key)
        _site.MANIFEST.unlink(missing_ok=True)
        print(f"\nclean in {time.time() - t0:.0f}s; manifest removed")
        return

    # -- state ----------------------------------------------------------------------------------------
    print("\ntemplates")
    tstate = {}
    for key in s.plan["templates"]:
        if key == "T6" and s.custom_type is None:
            tstate[key] = "skipped"
            print(f"  {key}  skipped")
            continue
        tid = s.find_template(key)
        if tid is None:
            tstate[key] = "missing"
        else:
            edited = None
            if key == "T3":
                by, _ = s.read_template(tid)
                edited = "Previs@Layout" in by
            mt, me, drift, _, _ = s.template_diff(key, tid, edited)
            tstate[key] = "pristine" if not (mt or me or drift) else \
                f"incomplete ({len(mt)} tasks, {len(me)} edges missing)" if not drift else "drifted: " + "; ".join(drift[:4])
        print(f"  {key}  {tid or '-':>6}  {tstate[key]}")
    seq_missing = s.sequences(False)
    print(f"sequences: {'missing ' + ', '.join(seq_missing) if seq_missing else 'present'}")

    print("\nscenarios")
    states = {}
    for sc in s.plan["scenarios"]:
        st, rows = s.state(sc)
        states[sc["id"]] = (st, rows)
        print(f"  {sc['id']:<5} {st}")
        if st == "drifted":
            print("\n".join("        " + x for x in s.drift_detail(sc)))

    if not write:
        print(f"\ndry run in {time.time() - t0:.0f}s. Pass --write to create what is missing.")
        return

    # -- write ------------------------------------------------------------------------------------------
    print("\nwriting")
    try:
        todo = [sc for sc in s.plan["scenarios"]
                if not s.skipped(sc["id"]) and (sc["id"] in reset or states[sc["id"]][0] == "missing")]
        for sc in s.plan["scenarios"]:
            if sc["id"] in reset and states[sc["id"]][0] not in ("missing", "skipped"):
                s.delete_scenario(sc, states[sc["id"]][1])
        fresh_t3 = any(sc["id"] == "S22" for sc in todo) and tstate.get("T3") != "missing" and \
            s.m["templates"].get("T3", {}).get("edited", True)
        if a.reset_templates:
            for key in s.plan["templates"]:
                s.delete_template(key)
        elif fresh_t3 and s.find_template("T3"):
            s.delete_template("T3")      # S22 needs T3 as it was before the edit
        tids = {}
        for key in s.plan["templates"]:
            if key == "T6" and s.custom_type is None:
                continue
            tids[key] = s.ensure_template(key)
        s.sequences(True)
        for sc in todo:
            s.create_scenario(sc, tids)
            if sc["id"] != "S22":
                s.finish_scenario(sc)
        if not s.m["templates"]["T3"].get("edited"):
            s.edit_t3()
        for sc in todo:
            if sc["id"] == "S22":
                s.finish_scenario(sc)
        s.m["tracking_settings_before"] = s.tracking
        s.m["people"] = s.users
        s.m["custom_type"] = s.custom_type
        s.m["default_status"] = s.default_status
        s.m["seeded_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        ids_t = {k: v["id"] for k, v in s.m["templates"].items()}
        print(f"\nset by hand in the project's Tracking Settings (Q7): Shot -> T2 {ids_t.get('T2')}, "
              f"Asset -> T4 {ids_t.get('T4')}")
    finally:
        _site.write_json(_site.MANIFEST, s.m)
        write_expectations(s.plan, s.custom_type)
        print(f"manifest {_site.MANIFEST}; expectations {_site.EXPECTATIONS}; {time.time() - t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
