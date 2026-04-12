# CLAUDE.md — wiki-plugin

## Struktur Repo

```
wiki-plugin/
├── docker/docker-compose.yml      # SiYuan server
├── .claude-plugin/marketplace.json
└── plugins/wiki/
    ├── .claude-plugin/plugin.json  # mcpServers + userConfig
    ├── skills/                     # wiki-query, wiki-ingest, wiki-lint
    └── mcp/
        ├── index.js                # entry point (require('./src/tools'))
        ├── bundle.js               # COMMITTED — pre-built esbuild output
        ├── package.json            # deps: @modelcontextprotocol/sdk, zod
        └── src/
            ├── tools.js            # 10 tool definitions (Zod schemas + handlers)
            ├── helpers.js          # resolveNotebook, makeClient, today
            ├── config.js           # reads SIYUAN_TOKEN/URL/NOTEBOOK dari env
            ├── siyuan-client.js    # SiYuan HTTP API client
            ├── journal-helpers.js  # journalAppend()
            ├── decision-helpers.js # createDecision()
            ├── crosslink-helpers.js
            ├── lint-helpers.js     # lintGaps() + lintGraph()
            ├── mine-helpers.js     # mineSessions() — pakai process.env.PWD
            ├── suggest-adr-helpers.js
            └── hash-helpers.js     # hashPath() untuk source tracking
```

## Workflow Develop

### Edit → Build → Test → Release

```bash
# 1. Edit src/*.js
# 2. Build bundle
cd plugins/wiki/mcp
npm run build

# 3. Test bundle langsung
SIYUAN_TOKEN=xxx node bundle.js

# 4. Bump versi di plugin.json + package.json
# 5. Commit (bundle.js wajib ikut di-commit)
git add -A && git commit -m "feat: ..."
git push

# 6. Update plugin di semua mesin yang pakai
claude plugin marketplace update wiki-plugin
claude plugin update wiki@wiki-plugin
```

### Aturan: bundle.js WAJIB di-commit

Plugin diinstall langsung dari GitHub. Tidak ada CI/CD yang build. Kalau bundle.js tidak di-commit → user install versi lama.

### Bump versi — wajib untuk trigger update

Claude Code cek versi sebelum update. Kalau versi sama → skip.
Bump di 2 tempat:
- `plugins/wiki/.claude-plugin/plugin.json` → `"version"`
- `plugins/wiki/mcp/package.json` → `"version"`

## Tambah Tool Baru

1. Buat helper di `src/nama-helpers.js` — export fungsi async
2. Import di `src/tools.js`
3. Tambah entry di object `tools` dengan Zod inputSchema + handler
4. Build bundle: `npm run build`
5. Verify: tool muncul di `tools/list`
6. Bump versi, commit bundle, push

## Konfigurasi MCP Server

Env vars yang diinject ke server (dari `plugin.json` → `userConfig` → `pluginConfigs` di settings.json):

| Env | Source | Default |
|-----|--------|---------|
| `SIYUAN_TOKEN` | `user_config.siyuan_token` | — wajib |
| `SIYUAN_URL` | `user_config.siyuan_url` | `http://127.0.0.1:6806` |
| `WIKI_DEFAULT_NOTEBOOK` | `user_config.default_notebook` | `camis-wiki` |
| `PWD` | Diinject otomatis oleh Claude Code | project aktif |

`PWD` tidak perlu dikonfigurasi — Claude Code otomatis inject saat spawn MCP server.

## SiYuan Docker

```bash
cd docker/
docker compose up -d    # start
docker compose stop     # stop (data aman di volume)
docker compose pull     # update SiYuan image
```

Volume data: `cc-stack_siyuan-workspace` (external, persistent).
SiYuan UI: `http://localhost:6806`
Auth code: `camis-wiki-dev` (set di docker-compose.yml)

## Catatan Penting

- `siyuan_token` di plugin.json: `sensitive: false` — karena private repo personal. Kalau suatu saat jadi public, ganti ke `sensitive: true` (token akan disimpan di keychain, bukan settings.json).
- `bundle.js` ~660KB setelah minify — mostly MCP SDK. Acceptable untuk committed binary.
- Skills (`wiki-query`, `wiki-ingest`, `wiki-lint`) di-load otomatis dari `plugins/wiki/skills/` saat plugin enabled.
