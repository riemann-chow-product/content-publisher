# content-publisher

> Write Markdown once, publish to multiple Chinese content platforms.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

[中文文档](./README.zh-CN.md) · **English (default)**

`content-publisher` is a CLI tool that converts, illustrates, and publishes a single
Markdown article to WeChat Official Accounts, Zhihu, Weibo, CSDN, Juejin, and more —
removing the repetitive work of copying content into each backend, uploading images by
hand, and reformatting over and over.

## Features

- **Write once, publish everywhere**: WeChat Official Accounts, Zhihu, Weibo, CSDN,
  Juejin, Jianshu, Toutiao, Yuque, 51CTO, SegmentFault, and OSChina.
- **Automatic image handling**: extracts inline images, uploads them, and replaces the
  references with platform-accessible URLs; can also generate covers and illustrations.
- **Local credentials**: config lives in `~/.content-publisher/config.json` (user home,
  never in the repo); `config list` masks sensitive fields automatically.
- **Multi-account isolation**: profiles let you switch between multiple accounts.
- **Template system**: built-in writing templates selected by article type.
- **No backend, no telemetry**: a purely local CLI. Nothing is uploaded anywhere except
  the target platforms you explicitly choose.

## Install

```bash
npm install -g content-publisher
```

Or from source:

```bash
git clone https://github.com/riemann-chow-product/content-publisher.git
cd content-publisher
npm install
npm link
```

Some publishing flows rely on Playwright. Install the browser once:

```bash
npx playwright install chromium
```

## Quick start

```bash
# 1. Configure credentials (interactive wizard, or set directly)
content-publisher account setup --platform wechat
content-publisher config set wechat.appid <YOUR_APPID>
content-publisher config set wechat.appsecret <YOUR_APPSECRET>

# 2. Inspect config (sensitive values are shown as ********)
content-publisher config list

# 3. Publish (saves to the WeChat draft box by default; never broadcasts)
content-publisher publish ./article.md --platform wechat

# List all commands
content-publisher --help
```

> WeChat's official API writes to the **draft box**. The "original" flag, collection
> assignment, and the final broadcast still have to be done in the WeChat backend.

## Commands

| Command | Description |
| --- | --- |
| `publish` | Publish a Markdown article to a given platform |
| `config` | View / set / delete config values, manage profiles |
| `account` | Interactively configure platform credentials |
| `template` | List / show built-in writing templates |
| `upload` | Upload image assets on their own |
| `generate` | Generate covers, illustrations, and article images |

Every subcommand supports `--help`, e.g. `content-publisher publish --help`.

## Supported platforms

| Platform | Auth | Notes |
| --- | --- | --- |
| WeChat Official Account | AppID + AppSecret (official API) | Writes to draft box |
| Zhihu | Token / Cookie | |
| Weibo | UID + access_token | |
| CSDN / Juejin / Jianshu / Toutiao / 51CTO / SegmentFault / OSChina | Cookie | Some use browser automation |
| Yuque | Bearer Token | |

Platform adapters live in `src/platforms/`. Adding a platform means subclassing
`base.js` and implementing the corresponding methods.

## Configuration

Config is stored in `~/.content-publisher/config.json`. Common keys:

| Key | Description |
| --- | --- |
| `wechat.appid` / `wechat.appsecret` | WeChat Official Account credentials |
| `wechat.default-author` | Default author (falls back to article front-matter) |
| `wechat.default-collection` | Default collection name |
| `zhihu.token` / `zhihu.cookies` | Zhihu credentials |
| `weibo.uid` / `weibo.cookies` | Weibo credentials |
| `global.default-platform` | Default target platform |
| `global.default-cover` | Default cover image path |

```bash
content-publisher config set <key> <value>
content-publisher config list
content-publisher account remove <platform>
```

**Security note**: `config.json` lives in your home directory, outside the repo, and
contains real AppSecrets / Cookies. Never commit, screenshot, or paste it. Scrub
credentials before sharing logs.

## Article format

Standard Markdown with YAML front-matter overrides:

```markdown
---
title: Article title
author: Author name
cover: ./cover.png
platform: wechat
---

## Body

Images in the body are uploaded automatically during publishing.
```

Built-in templates: `default`, `cover`, `rich`, `tech-deep`, `tutorial`, `news`,
`opinion`, `case-study`, `tech-essay`. Run `content-publisher template list` to see
them.

> Follow banners, QR codes, and similar items in the templates are **optional branding
> assets** supplied and configured by the user. This repo ships no personal or
> third-party brand images.

## Optional: use with an Agent Skill

`skills/content-publisher/` contains a skill description for agents such as Claude Code
and Codex, so publishing can be triggered directly from a conversation.

For social card / cover visual generation, a third-party skill can be installed
separately (independent of this project, with its own license):

```bash
npx skills add https://github.com/op7418/social-card --skill social-card
```

> That project is GNU AGPL-3.0. This repo neither bundles nor modifies its code;
> please respect its own license.

## Development

```bash
npm test            # node --test test/
npm run lint        # eslint src/
npm pack --dry-run  # inspect the tarball that would be published
```

## License

[MIT](./LICENSE) © 2026 riemann-chow-product

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contributions.

---

## In-article diagrams (Archify-style static images)

WeChat / CSDN only accept static images, so the project ships a **static image
renderer** that borrows the visual language of
[Archify](https://github.com/tt-a1i/archify): grouped lanes (trust boundaries), typed
node cards, bezier edges, **highlighted primary paths**, a legend, title / footnote,
and dark / light themes. Output is a **2x high-resolution PNG** (2400×1350 by
default), so it stays sharp after mobile downscaling.

### Writing a diagram in an article

````markdown
```diagram fig1.png
{
  "title": "GroveMQ two-tier load balancing",
  "subtitle": "The access tier only distributes connections; the forwarding tier owns delivery semantics",
  "badge": "ARCHITECTURE",
  "theme": "dark",
  "groups": [
    { "id": "access", "label": "Access / L4", "tone": "cyan" },
    { "id": "forward", "label": "Forwarding", "tone": "violet" }
  ],
  "nodes": [
    { "id": "lb", "label": "L4 Service", "sub": "ClientIP affinity", "kind": "network", "group": "access" },
    { "id": "n1", "label": "Broker N1", "kind": "service", "group": "forward" },
    { "id": "db", "label": "Subscription table", "kind": "db", "group": "forward" }
  ],
  "edges": [
    { "from": "lb", "to": "n1", "label": "CONNECT", "primary": true },
    { "from": "n1", "to": "db", "dashed": true }
  ],
  "footnote": "Falls back to fan-out when load data is stale"
}
```
````

Then run:

```bash
content-publisher generate article-images article.md --out-dir ./imgs
```

The `diagram` block is rendered to `fig1.png` and **replaced with an image reference**
(use `--keep-block` to keep the code block). Existing `![alt](x.png)` references whose
file is missing are also generated as Archify-style concept diagrams or code screenshots —
no more "a card containing only the alt text".

### Standalone generation

```bash
# spec can be a .json file, a JSON string, or - to read from stdin
content-publisher generate diagram spec.json --out fig.png
content-publisher generate diagram '{"nodes":[{"id":"a","label":"A"}]}' --out a.png
cat spec.json | content-publisher generate diagram - --style light --out fig-light.png
```

### Spec fields

| Field | Description |
| --- | --- |
| `title` / `subtitle` / `badge` / `footnote` | Title, subtitle, top-right type badge, bottom-right footnote |
| `theme` | `dark` (default) / `light` |
| `layout` | `lanes` (default when `groups` exist) / `row` / `column` |
| `groups[]` | `{ id, label, tone }`; `tone`: blue/cyan/violet/green/amber/pink/gray |
| `nodes[]` | `{ id, label, sub, kind, group }`; `kind`: client/network/service/db/cache/queue/external |
| `edges[]` | `{ from, to, label, primary, dashed }`; `primary` uses the highlighted gradient path |
| `legend` | `true` by default; generates a legend from the kinds present |

### Visual specification

- Each node has a 3px type-color bar and a type glyph; the semantic colors are fixed
  (blue = client, cyan = network, violet = service, green = storage, …)
- Groups are dashed lane frames with a glowing group title, expressing trust boundaries
- Primary edges use a `#58a6ff → #a371f7` gradient, glow, and arrowheads; normal edges
  are thin solid-color lines and can be dashed
- Edges are drawn as SVG after measuring node positions in the browser; layout is pure
  CSS, so no graph-layout library is needed
- All copy goes through `escapeHTML`, and `</script>` inside a spec is escaped to
  prevent injection

Modules: `src/lib/diagram.js` (spec → HTML), `src/lib/generator.js`
(`generateDiagram`), `src/commands/generate.js` (CLI). Regression tests:
`test/diagram.test.js`.

### Render validation and auto-repair

Before every screenshot the renderer runs **11 checks** in the browser. Any failure
triggers automatic repair (up to 8 rounds); if it still fails, `generateDiagram`
**throws and refuses to produce a bad image**:

| Rule | Checks | Auto-repair |
| --- | --- | --- |
| `canvasOverflow` | Nodes / title / legend stay inside the canvas | Tighten spacing, scale down |
| `nodeOverlap` | No two nodes overlap | Tighten spacing, scale down |
| `textClipped` | Node text is not truncated by `ellipsis` | Reduce font size stepwise, widen nodes |
| `edgeLength` | Edge length ≥ 8px (arrow visible) | Stop squeezing gaps, scale instead |
| `canvasRatio` | Content occupies ≤ 90% width / 88% height of the stage | Tighten spacing, scale down |
| `labelOverlap` | Edge labels do not overlap each other | Grid-search repositioning, smaller font |
| `labelNodeClearance` | Labels do not cover node cards | Grid-search repositioning, leader lines |
| `labelTextClearance` | **Label ↔ any text distance ≥ 8px** | Grid-search repositioning |
| `labelArrowClearance` | **Label ↔ arrow distance ≥ 12px** | Reposition, push arrow out if needed |
| `arrowClearance` | **Arrow ↔ any text distance ≥ 12px** | Auto-increase `arrowGap` |
| `arrowRendered` | **Every edge has a genuinely rendered arrowhead** | Glow goes on a separate underlay path; never put a filter on a path with a marker |

The avoidance set includes **every visible text element**: lane titles
(`.lane-label` / `.lane-head`), main / sub titles, badge, footnote, legend, node titles
and subtitles. The lane title "Forwarding / Cluster" was once overlapped by a vertical
edge label `PublishForward` by 848px², because only `.node` cards were treated as
obstacles early on.

Arrowheads are uniformly **standard solid triangles**:
`markerUnits="userSpaceOnUse"` (fixed 12×10px, not distorted by stroke width),
`orient="auto"` (points along the end tangent), `refX=11` (tip lands exactly on the
target node edge). Vertical edges are detected by whether the two node x-centers share a
column, so adjacent nodes inside one lane are no longer drawn as backward-bending curves.

Three rendering bugs were fixed along the way:

- **Missing arrowheads on primary edges**: the main path carried both
  `filter="url(#glow)"` and `marker-end`, but a horizontal path has a `getBBox()` height
  of 0. The `objectBoundingBox` filter region collapsed to zero height and Chromium
  clipped the `marker-end` along with it (exactly the 2 primary edges). The glow now
  lives on a **separate underlay path** (filter, no marker), and marker paths carry no
  filter at all. The filter itself uses `filterUnits="userSpaceOnUse"`.
- **Invisible horizontal lines**: `stroke="url(#primary)"` used the default
  `objectBoundingBox` gradient, which does not render at all on a zero-height bbox
  (pixel diff = 0). Normal edges were also too faint at 1.5px, and
  `dx=Math.max(12, …)` on a 15.8px edge made the control points cross into a loop.
  The gradient is now `gradientUnits="userSpaceOnUse"` spanning the stage width, normal
  edges use the high-contrast `edgeStrong` color at 2.2 / 3px, control points converge
  with edge length, and the minimum node gap was raised from 30 to 38px (edge length
  15.8 → 22.7px). Arrowheads use a matching high-contrast theme color.
- **Canvas proportion**: short horizontal flows automatically shrink the canvas height
  (1200×675 → as low as 1200×360) so the diagram is not stranded in a sea of empty
  space. The shrunken layout is re-validated, and falls back to the original size if it
  fails.

Print the full report:

```bash
content-publisher generate diagram spec.json --out fig.png --audit-json
```

Report example (`window.__DIAGRAM_AUDIT__`, also returned by `generateDiagram()`):

```json
{
  "passed": true,
  "rounds": 5,
  "scale": 0.86,
  "arrowGap": 8,
  "ratios": { "w": 0.84, "h": 0.34 },
  "repairs": ["label-size->14", "flat-gap->38", "scale->0.93", "scale->0.86"],
  "checks": {
    "arrowClearance": { "ok": true, "detail": "0 arrow/text conflicts, min distance=26.4px" },
    "labelTextClearance": { "ok": true, "detail": "0 labels too close to text, min distance=14.2px" },
    "labelArrowClearance": { "ok": true, "detail": "0 labels too close to arrows, min distance=27.5px" }
  }
}
```

Use `--no-auto-fit` to disable canvas height fitting. See `test/diagram.test.js` for
regression tests (crowded layouts, arrow distances, pixel-level arrow/line rendering,
and refusal to emit bad images).
