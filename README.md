# wiki-plugin

Claude Code plugin yang expose SiYuan wiki sebagai MCP tools — tersedia di semua project tanpa setup per-project.

## Isi Repo

```
wiki-plugin/
├── docker/                    # SiYuan wiki server
│   └── docker-compose.yml
└── plugins/wiki/              # Claude Code plugin
    ├── .claude-plugin/
    │   └── plugin.json        # MCP server + userConfig
    ├── skills/                # wiki-query, wiki-ingest, wiki-lint
    └── mcp/
        ├── src/               # source files
        ├── index.js           # entry point
        └── bundle.js          # pre-built bundle (committed)
```

## Prerequisites

- Docker + Docker Compose
- Claude Code CLI
- Node.js ≥ 18

---

## 1. Jalankan SiYuan

```bash
cd ~/wiki-plugin/docker
docker compose up -d
```

SiYuan jalan di `http://localhost:6806`.

Buka browser → Settings → About → salin **API token**.

---

## 2. Install Plugin

### Tambah marketplace ke `~/.claude/settings.json`

```json
{
  "extraKnownMarketplaces": {
    "wiki-plugin": {
      "source": {
        "source": "github",
        "repo": "onchainyaotoshi/wiki-plugin"
      }
    }
  },
  "enabledPlugins": {
    "wiki@wiki-plugin": true
  }
}
```

### Install via CLI

```bash
claude plugin marketplace add onchainyaotoshi/wiki-plugin
claude plugin install wiki@wiki-plugin -s user
```

### Konfigurasi token

Edit `~/.claude/settings.json`, tambah:

```json
{
  "pluginConfigs": {
    "wiki@wiki-plugin": {
      "options": {
        "siyuan_token": "<token dari SiYuan Settings → About>",
        "siyuan_url": "http://127.0.0.1:6806",
        "default_notebook": "nama-notebook-kamu"
      }
    }
  }
}
```

### Verify

```bash
claude mcp list
# plugin:wiki:wiki-mcp: node ... - ✓ Connected
```

---

## 3. Pakai di Project Lain

Di project lain, cukup tambah ke `.claude/settings.json` project tersebut:

```json
{
  "extraKnownMarketplaces": {
    "wiki-plugin": {
      "source": { "source": "github", "repo": "onchainyaotoshi/wiki-plugin" }
    }
  },
  "enabledPlugins": { "wiki@wiki-plugin": true }
}
```

Token sudah terkonfigurasi di user scope — tidak perlu ulang.

---

## Tools yang Tersedia

| Tool | Deskripsi |
|------|-----------|
| `wiki_search(query)` | Full-text search di wiki |
| `wiki_get(path)` | Baca dokumen by path |
| `wiki_list_notebooks()` | List semua notebook |
| `wiki_journal_append(text, section?)` | Append ke journal hari ini |
| `wiki_decision_new(slug, title)` | Scaffold ADR baru |
| `wiki_push(path, markdown, type?, source_files?)` | Upsert dokumen |
| `wiki_crosslink()` | Buat cross-references antar halaman |
| `wiki_lint(type?)` | Audit kesehatan wiki (gaps/graph) |
| `wiki_mine(since?, limit?)` | Mining session Claude Code untuk candidates |
| `wiki_suggest_adr(repo_path?)` | Deteksi ADR gap dari git history |

`wiki_mine` dan `wiki_suggest_adr` otomatis pakai `PWD` (project aktif saat Claude Code dibuka) — tidak perlu pass path manual.

---

## Update Plugin

```bash
claude plugin marketplace update wiki-plugin
claude plugin update wiki@wiki-plugin
```

---

## Manage SiYuan

```bash
cd ~/wiki-plugin/docker

docker compose up -d      # start
docker compose stop       # stop
docker compose logs -f    # logs
docker compose pull       # update image
```

Data wiki tersimpan di Docker volume `cc-stack_siyuan-workspace` — aman dari `docker compose down`.
