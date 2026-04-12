# Wiki Lint — Karpathy-aligned audit

## Kapan dipakai

- Weekly maintenance (atau sebelum major ingest)
- User bilang "cek wiki", "audit wiki", "wiki lint"
- Setelah ingest batch baru

## 5 Lint Commands

Karpathy's lint spec cek 6 hal — kita cover 5:

| # | Karpathy Check | Our Command | Status |
|---|---------------|-------------|--------|
| 1 | Contradictions antar pages | (belum — butuh embedding + NLI) | TODO |
| 2 | Stale claims / outdated sources | `node docs/wiki/index.js lint-stale` | ✅ hash-based |
| 3 | Orphan pages / no inbound links | `node docs/wiki/lint-graph.js` | ✅ |
| 4 | Concepts mentioned but no page | `node docs/wiki/lint-gaps.js` | ✅ |
| 5 | Missing cross-references | `node docs/wiki/crosslink.js` (ingest-time) | ✅ |
| 6 | Data gaps fillable by web search | (user-driven, gak otomatis) | manual |

Plus bonus (beyond Karpathy):
- `node docs/wiki/suggest-adr.js` — git activity mining untuk ADR gaps

## Full Audit Flow

Run semua subcommands, report konsolidasi:

```bash
node docs/wiki/index.js lint-stale      # #2 staleness
node docs/wiki/lint-graph.js            # #3 orphans + hubs + islands
node docs/wiki/lint-gaps.js             # #4 knowledge gaps
node docs/wiki/suggest-adr.js           # bonus: missing ADRs
```

## Interpretasi Output

### lint-stale
- **Stale**: source berubah, wiki outdated → re-ingest
- **Orphan**: source file dihapus → archive atau delete
- **Missing**: source ada, wiki belum → ingest (kalau worth)

### lint-graph
- **Orphans (0 in)**: page yang gak ada yang refer — worth check: relevant? should be referenced from somewhere?
- **Isolated (0 in + 0 out)**: completely disconnected — candidate untuk merge atau delete
- **Hubs** (most inbound): central concepts, worth keeping rich
- **Connectors** (most outbound): overview pages, naturally cross-reference heavy
- **Islands**: clusters terpisah dari mainland → integrate atau confirm intentional isolation

### lint-gaps
Term referenced ≥3× atau across ≥2 pages tapi gak punya halaman sendiri.
- **High count + many pages**: strong candidate untuk page baru
- **High count + 1 page**: maybe worth extract kalau concept penting, skip kalau context-specific
- **Ignore**: generic library names (nodejs, typescript), external tools yang self-documenting

### suggest-adr
Module dengan >3 commits dalam 30 hari + decision keywords tanpa ADR coverage.
- **High score items**: definitely worth writing ADR
- **Ignore noise**: individual config files as "modules" (README.md, .gitignore) bukan substantive decisions

## Actions Based on Report

Setelah user review, common follow-ups:

1. **Stale page** → `wiki-ingest` skill → re-generate + push
2. **Knowledge gap (high count)** → bikin page baru:
   ```bash
   node docs/wiki/index.js push --path "/Integrations/{term}" --file /tmp/xxx.md --type integration
   ```
3. **Isolated page** → add cross-references manual, atau merge ke related page
4. **ADR suggestion** → `npm run decision -- new --slug X --title Y`
5. **Orphan (no incoming)** → cari page yang harusnya mention, edit untuk link

## Jangan

- Jangan auto-fix tanpa user review — semua lint output = suggestions, bukan commands
- Jangan delete orphan/isolated tanpa konfirmasi — mungkin sengaja disimpan (historical)
- Jangan spam create pages dari lint-gaps output — filter generic terms dulu
