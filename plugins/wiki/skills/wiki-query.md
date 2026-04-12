# Wiki Query — SiYuan adalah single source of truth

## Kapan dipakai

- **WAJIB** sebelum mulai kerja di modul yang belum familiar
- User tanya "kenapa", "how does X work", "apa history-nya"
- Butuh konteks decision / architectural rationale
- Butuh tahu gotcha sebelum modifikasi

Wiki simpan knowledge yang **BUKAN di source code**:
- Decisions (ADR) — kenapa dilakukan begitu
- Journal — dev log harian
- Investigations — bug research + dead-ends
- Gotchas — consolidated pitfalls
- Integrations — pattern per external system
- Guides — how-to
- Infra — ops knowledge (Docker, tunnel, vendor)
- Stakeholders — konteks non-teknis

Knowledge yang ADA di source code (implementasi per menu/worker/component) **tidak disimpan** di wiki — baca source langsung, lebih akurat.

## Flow

### 1. Decide: wiki or code?

- Pertanyaan "kenapa" / "design choice" / "history" → **wiki**
- Pertanyaan "apa yang dilakukan" / "implementation" → **source code**
- Pertanyaan "gotcha" / "pitfall" / "jangan lakukan X" → **wiki**

### 2. Search wiki

MCP tool (available di semua project):
```
wiki_search(query="keyword")
```

### 3. Baca top results

```
wiki_get(path="/Decisions/adr-xxx")
wiki_get(path="/Gotchas/known-pitfalls")
```

Wiki paths:
- `/Decisions/` — ADR, architecture rationale
- `/Journal/{YYYY-MM-DD}` — dev log
- `/Investigations/` — bug deep-dives
- `/Gotchas/` — pitfalls
- `/Integrations/` — external system patterns
- `/Guides/` — how-to
- `/Infra/` — ops
- `/Stakeholders/` — non-tech context
- `/Pages/`, `/Components/` — hand-curated only, jarang dipakai

### 4. Synthesize jawaban

- Cite wiki paths: "Menurut `/Decisions/adr-connect-ginee`..."
- Ikuti cross-refs kalau ada (SiYuan refs look like `((id "text"))` di kramdown, jadi clickable link di UI)

### 5. Kalau wiki gak punya jawaban

a. Baca source code langsung (Read tool)
b. Jawab pertanyaan
c. **Putuskan**: worth di-ingest ke wiki?
   - Decision rationale → YES, `wiki_decision_new(slug, title)`
   - Gotcha / bug pattern → YES, `wiki_journal_append(text, section="Gotcha")`
   - Investigation → YES, buat `/Investigations/{topic}`
   - Implementation detail → NO, sudah di source
d. Kalau YES, jalankan flow wiki-ingest

## Tips

- Gunakan keyword spesifik: nama function, model Odoo, nama fitur
- Kalau search kosong, coba variant: underscore vs dash, ID vs EN
- Kalau nemu knowledge baru saat kerja, **ingest ke wiki sebelum lupa** — `wiki_journal_append(text, section="What Happened")`
- Weekly: run `npm run wiki:crosslink` setelah ingest batch baru — ini yang bikin graph view grow over time
