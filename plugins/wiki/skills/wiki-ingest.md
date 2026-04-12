# Wiki Ingest — Simpan knowledge ke wiki

## Kapan dipakai

- Setelah deep-dive / investigation
- Setelah fix bug yang reveal gotcha baru
- Setelah decide arsitektur pilihan
- End of work session — journal update

## Ingest by type

### A. Journal (daily log)

MCP tool — langsung, tidak perlu shell:
```
wiki_journal_append(text="Fix bug XYZ, root cause: ...", section="What Happened")
wiki_journal_append(text="Migrate ke pattern Y", section="Next")
```

Auto-create `/Journal/{YYYY-MM-DD}` kalau belum ada. Append dengan timestamp.

Sections: `What Happened`, `Blockers / Open Questions`, `Next`.

### B. ADR (Architecture Decision Record)

MCP tool:
```
wiki_decision_new(slug="use-x-for-y", title="Use X for Y")
```

Buat skeleton di `/Decisions/adr-use-x-for-y`. Edit via SiYuan UI atau push balik:
```
wiki_push(path="/Decisions/adr-use-x-for-y", markdown="...", type="decision")
```

Sections: `Status`, `Context`, `Decision`, `Consequences`, `Alternatives`.

### C. Gotcha / Investigation / Integration / Infra / Guide

Untuk ingest dengan full attrs (`--tags`, `--source-files`, `--source-hash`) — tetap pakai CLI:

```bash
node docs/wiki/index.js push \
  --path "/Gotchas/ginee-shelf-stale" \
  --file /tmp/wiki-xxx.md \
  --type gotcha \
  --tags "ginee,data-integrity" \
  --source-files "modules/cafin/v3/pages/warehouse_inbound/index.js" \
  --source-hash "$(node docs/wiki/sources.js hash modules/cafin/v3/pages/warehouse_inbound/index.js)"
```

Atau via MCP kalau cukup dengan type saja (tanpa source tracking):
```
wiki_push(path="/Gotchas/nama-gotcha", markdown="...", type="gotcha")
```

Template sections (dari `schema.js`):
- Decision → `Status, Context, Decision, Consequences, Alternatives`
- Investigation → `Symptom, Reproduction, Hypothesis Tested, Dead Ends, Root Cause, Fix`
- Gotcha → `Description, Root Cause, Fix / Workaround, Affected Files`
- Integration → `Overview, Auth, Key Endpoints, Error Handling, Gotchas`
- Infra → `Purpose, Configuration, Access/Credentials, Runbook, Vendor Contact`
- Guide → `Goal, Prerequisites, Steps, Verification, Troubleshooting`
- Stakeholder → `Role/Context, Decision Scope, Communication Preferences, Recent Feedback`

### D. Setelah batch ingest: crosslink!

```bash
npm run wiki:crosslink
```

Ini yang bikin graph view grow. Jalanin setiap habis ingest batch baru (>3 pages).

## Guidelines

- **Scope**: wiki untuk knowledge yang BUKAN di source code. Jangan copy implementation detail.
- **Size**: 1-3KB per page. Concise > comprehensive.
- **Cross-ref**: kalau mention concept lain, tulis natural — crosslink.js akan convert jadi actual SiYuan ref
- **Bahasa**: campur ID/EN seperti project
- **Attrs**: untuk gotcha/integration/guide, prefer CLI dengan `--source-hash` dan `--source-files` supaya lint-stale bisa detect staleness

## Jangan

- Jangan ingest implementation detail (itu di source code)
- Jangan ingest tanpa set source-hash untuk halaman yang ada linked source file (lint-stale gak bisa detect staleness)
- Jangan skip crosslink — graph view kosong = value hilang
