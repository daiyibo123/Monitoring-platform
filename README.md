<div align="center">

# 🛰️ 中转站监控平台 · Relay Monitor

**监控 AI API 中转站的可用性、分组倍率与账户余额**
**Monitor availability, group ratios & account balances of AI API relay stations**

<p>
  <img alt="Cloudflare Pages" src="https://img.shields.io/badge/Cloudflare-Pages%20%2B%20Functions-F38020?logo=cloudflare&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind-3-38BDF8?logo=tailwindcss&logoColor=white">
  <img alt="D1" src="https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white">
</p>

[中文](#-中文) · [English](#-english)

</div>

---

## 🇨🇳 中文

一个自托管的中转站监控面板：把你所有的 AI API 中转站（New-API / One-API / sub2api / OpenAI 兼容）集中到一屏，一键测活，实时掌握**连通性、分组倍率、可用模型与账户余额**。前后端全部跑在 **Cloudflare Pages + Functions + D1** 上，一次部署，处处可用。

### ✨ 功能特性

- **多网站 / 多分组**：一个中转站下挂多个 Key（分组），统一管理。
- **一键测活 + 倍率 + 模型**：点一次「测活」同时完成——
  - `GET /v1/models` 判断分组是否可用、拉取可用模型列表；
  - `GET /api/pricing`（New-API/One-API）解析**分组倍率**与**每个模型的倍率**；sub2api 走 `GET /v1/sub2api/billing`。
- **余额（网站级）**：一个网站 = 一个账户，余额只在网站行显示一次，不按 Key 叠加；总余额 = 各网站余额之和。
- **倍率升序**：网站内 Key 自动**从低倍率到高倍率**排序（未测活的排最后），无论全部展示还是按渠道筛选都保持一致。
- **自动识别厂商**：根据返回的模型列表判断 Key 属于哪一家（GPT / Claude / Grok / GLM / Gemini / DeepSeek / Qwen / Kimi），打标签并可**按渠道筛选**。
- **结果持久化**：测活结果存入 D1，不重新测活也始终显示上次的倍率 / 余额。
- **单账号 + 密码解锁编辑**：登录后默认**查看模式**（测活 / 复制 / 看余额，只读）；点「编辑」再次输入密码解锁**编辑模式**才可增删改，服务端强制校验，绕不过前端。
- **精致 UI**：暗色玻璃拟态、发光统计磁贴、极光动效背景，一行一站、单行 Key 的紧凑布局。

### 🧱 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite + Tailwind CSS（构建为静态资源） |
| 后端 | Cloudflare Pages Functions（`/functions/api/*`） |
| 存储 | Cloudflare D1（SQLite） |
| 鉴权 | HMAC-SHA256 签名会话（HttpOnly / Secure / SameSite=Strict Cookie），Web Crypto 实现 |

> 所有上游请求都在服务端发起，天然规避浏览器 CORS，API Key 不会下发到前端。

### 🚀 本地开发

```bash
npm install

# 1) 配置本地密钥
cp .dev.vars.example .dev.vars
#   编辑 .dev.vars，设置 APP_PASSWORD 和 SESSION_SECRET
#   生成随机密钥：openssl rand -hex 32
#   APP_PASSWORD 既是登录密码，也是解锁编辑模式的密码
#   可选：再设 APP_PASSWORD2 作为第二个等价密码（两个都能登录、都能解锁编辑）
#   登录用户名默认 admin（可用 ADMIN_USERNAME 覆盖）

# 2) 初始化本地数据库（可选，应用首次请求会自动建表）
npm run db:init

# 3) 构建并启动（Pages Functions + 静态资源 + 本地 D1）
npm run pages:dev
# 打开 http://127.0.0.1:8788
```

### ☁️ 部署到 Cloudflare Pages

**方式一：命令行**

```bash
npx wrangler login

# 创建 D1，把返回的 database_id 填入 wrangler.toml
npx wrangler d1 create relay-monitor

npm run build
npx wrangler pages deploy dist

# 设置密钥（必须，否则无法登录）
npx wrangler pages secret put APP_PASSWORD
npx wrangler pages secret put SESSION_SECRET
npx wrangler pages secret put ADMIN_USERNAME   # 可选，默认 admin
```

**方式二：控制台 Git 集成**

- 构建命令 `npm run build`，输出目录 `dist`
- Settings → Functions → D1 database bindings：变量名 `DB` → 选择 `relay-monitor`
- Settings → Environment variables：加 `APP_PASSWORD`、`SESSION_SECRET`（加密变量），可选 `ADMIN_USERNAME`

### 🔧 添加站点时如何选类型

| 类型 | 倍率来源 | 适用 |
|------|----------|------|
| `newapi` | `GET /api/pricing` | New-API / One-API 及其衍生（最常见） |
| `sub2api` | `GET /v1/sub2api/billing`（倍率）+ `GET /v1/usage`（余额） | sub2api 网关 |
| `openai` | 不获取倍率 | 纯 OpenAI 兼容端点，仅测活 + 余额 |

**分组标识**：中转站若按分组区分倍率（如 `default` / `vip`），在 Key 上填对应分组标识即可匹配；留空取默认分组。

### 🔒 安全说明

- 所有 `/api/*`（除登录 / 会话检查）都需有效会话 Cookie；凭据用常量时间比较校验，令牌用 `SESSION_SECRET` 做 HMAC 签名、携带 `edit` 标志、7 天过期。
- 登录后默认只读；解锁编辑（`/api/unlock`）需再次校验密码，服务端才重签 `edit:true` 令牌，写操作在中间件强制拦截（403）。
- 中转站 API Key 以明文存储在 D1（Cloudflare 对 D1 静态加密，但库内明文）。这是单用户工具在登录门 + HTTPS 下的合理取舍，请勿开放给不受信任的人。
- 请为 `APP_PASSWORD` 用强密码，`SESSION_SECRET` 用足够长的随机串。页面已设 `noindex` 防收录。

---

## 🇬🇧 English

A self-hosted dashboard for monitoring AI API relay stations (New-API / One-API / sub2api / OpenAI-compatible). Bring all your relays onto one screen, test them with a click, and keep an eye on **connectivity, group ratios, available models, and account balances**. Frontend and backend run entirely on **Cloudflare Pages + Functions + D1** — deploy once, run anywhere.

### ✨ Features

- **Multi-site / multi-group**: manage many keys (groups) under each relay station.
- **One-click test + ratios + models**: a single "test" fetches everything —
  - `GET /v1/models` to check availability and list accessible models;
  - `GET /api/pricing` (New-API/One-API) to parse the **group ratio** and **per-model ratios**; sub2api uses `GET /v1/sub2api/billing`.
- **Balance (site-level)**: one site = one account. The balance is shown once per site (never multiplied per key); the total is the sum across sites.
- **Ratio ascending**: keys are sorted **from low to high ratio** (untested last), consistently whether showing all or filtering by channel.
- **Auto provider detection**: infers the provider from the returned model list (GPT / Claude / Grok / GLM / Gemini / DeepSeek / Qwen / Kimi), tags it, and lets you **filter by channel**.
- **Persisted results**: test results are stored in D1, so the last ratios/balance stay visible without re-testing.
- **Single account + password-unlocked editing**: after login you're in **view mode** (test / copy / view balance, read-only); click "Edit" and re-enter the password to unlock **edit mode** for create/update/delete — enforced server-side, not bypassable from the client.
- **Polished UI**: dark glassmorphism, glowing stat tiles, an aurora-animated background, and a compact one-site-per-row / single-line-key layout.

### 🧱 Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite + Tailwind CSS (built to static assets) |
| Backend | Cloudflare Pages Functions (`/functions/api/*`) |
| Storage | Cloudflare D1 (SQLite) |
| Auth | HMAC-SHA256 signed sessions (HttpOnly / Secure / SameSite=Strict cookie) via Web Crypto |

> All upstream requests are made server-side, avoiding browser CORS and never sending API keys to the frontend.

### 🚀 Local Development

```bash
npm install

# 1) Configure local secrets
cp .dev.vars.example .dev.vars
#   Edit .dev.vars: set APP_PASSWORD and SESSION_SECRET
#   Generate a random secret: openssl rand -hex 32
#   APP_PASSWORD is both the login password and the edit-mode unlock password
#   Optional: set APP_PASSWORD2 as a second, fully-equivalent password (either logs in and unlocks editing)
#   Login username defaults to "admin" (override with ADMIN_USERNAME)

# 2) Initialize the local DB (optional; tables auto-create on first request)
npm run db:init

# 3) Build and serve (Pages Functions + static assets + local D1)
npm run pages:dev
# open http://127.0.0.1:8788
```

### ☁️ Deploy to Cloudflare Pages

**Option A: CLI**

```bash
npx wrangler login

# Create D1 and paste the returned database_id into wrangler.toml
npx wrangler d1 create relay-monitor

npm run build
npx wrangler pages deploy dist

# Set secrets (required, or login won't work)
npx wrangler pages secret put APP_PASSWORD
npx wrangler pages secret put SESSION_SECRET
npx wrangler pages secret put ADMIN_USERNAME   # optional, defaults to "admin"
```

**Option B: Dashboard Git integration**

- Build command `npm run build`, output directory `dist`
- Settings → Functions → D1 database bindings: variable `DB` → select `relay-monitor`
- Settings → Environment variables: add `APP_PASSWORD`, `SESSION_SECRET` (encrypted), optionally `ADMIN_USERNAME`

### 🔧 Choosing a Site Type

| Type | Ratio source | Use for |
|------|--------------|---------|
| `newapi` | `GET /api/pricing` | New-API / One-API and derivatives (most common) |
| `sub2api` | `GET /v1/sub2api/billing` (ratios) + `GET /v1/usage` (balance) | sub2api gateways |
| `openai` | none | plain OpenAI-compatible endpoints, test + balance only |

**Group name**: if the relay differentiates ratios by group (e.g. `default` / `vip`), set the matching group name on the key; leave blank for the default group.

### 🔒 Security Notes

- Every `/api/*` route (except login / session check) requires a valid session cookie. Credentials use constant-time comparison; the token is HMAC-signed with `SESSION_SECRET`, carries an `edit` flag, and expires after 7 days.
- After login you're read-only; unlocking edit mode (`/api/unlock`) re-verifies the password before the server re-signs an `edit:true` token, and writes are blocked in middleware (403) otherwise.
- Relay API keys are stored in plaintext in D1 (Cloudflare encrypts D1 at rest, but rows are plaintext). This is a reasonable trade-off for a single-user tool behind a login gate + HTTPS — do not expose it to untrusted users.
- Use a strong `APP_PASSWORD` and a long random `SESSION_SECRET`. The page is set to `noindex`.

---

<div align="center">

Built with ⚡ on Cloudflare · MIT-friendly for personal use

</div>
