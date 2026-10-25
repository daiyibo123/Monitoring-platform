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
- **真实请求测活**：用该 Key 能用的最便宜模型发一次真实 `"hi"` 请求（`max_tokens=1`），**只有真正返回补全才算可用**。自动适配 Anthropic `/v1/messages`、OpenAI `/v1/chat/completions` / `/v1/responses`、Gemini 原生接口，以及 `max_tokens` 参数不兼容、只支持流式、sub2api「仅限 Claude Code」分组等情况；失败的请求不消耗 token。
- **四种状态**：可用 / 无额度（Key 有效但余额用尽）/ 不可用（Key 被拒绝，或没有任何可用模型）/ 检测异常（超时、网关错误、防护拦截、上游限流等未能得出结论的情况，不会把能用的 Key 判成不可用）。展开 Key 可查看每次探测请求的记录。
- **倍率与模型**：`GET /api/pricing`（New-API/One-API）解析**分组倍率**与**每个模型的倍率**；sub2api 走 `GET /v1/sub2api/billing`。
- **余额（网站级）**：一个网站 = 一个账户，余额只显示一次，不按 Key 叠加；总余额 = 各网站余额之和。读取失败时保留上次的余额。
- **排序**：网站按「可用在前、不可用在后」排列，每一类里再按余额从高到低；网站内的 Key 同样可用在前，再按倍率从低到高。
- **每日自动测活**：每天（北京时间）首次打开面板时，自动把当天还没测过的 Key 测一遍；每个 Key 每天最多自动测一次，多台设备同时打开也不会重复测。
- **自动识别厂商**：根据返回的模型列表判断 Key 属于哪一家（GPT / Claude / Grok / GLM / Gemini / DeepSeek / Qwen / Kimi），打标签并可**按渠道筛选**。
- **结果持久化**：测活结果存入 D1，不重新测活也始终显示上次的倍率 / 余额。
- **单账号 + 密码解锁编辑**：登录后默认**查看模式**（测活 / 复制 / 看余额，只读）；点「编辑」再次输入密码解锁**编辑模式**才可增删改，服务端强制校验，绕不过前端。
- **界面**：参考 sub2api 的青色系暗色主题，玻璃质感卡片、统计磁贴、测活进度条，适配手机。

### 🧱 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite + Tailwind CSS（构建为静态资源） |
| 后端 | Cloudflare Pages Functions（`/functions/api/*`） |
| 存储 | Cloudflare D1（SQLite） |
| 鉴权 | HMAC-SHA256 签名会话（HttpOnly / Secure / SameSite=Lax Cookie），Web Crypto 实现 |

> 所有上游请求都在服务端发起，天然规避浏览器 CORS。网站列表只返回脱敏后的 Key，完整 Key 仅在点击「显示 / 复制」时按需获取；访问令牌永不下发到前端。

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

**访问令牌（可选，仅 New-API）**：部分 New-API 站点把 `/api/pricing` 锁在登录之后，用中转 `sk-` key 会返回 401，导致倍率读不到。此时在该站「个人设置 → 生成访问令牌」复制访问令牌，填到网站的「访问令牌」字段，即可读取分组倍率和账户余额（`/api/user/self`）；测活仍用 `sk-` key。新版 New-API 使用访问令牌时还要求 `New-Api-User` 请求头，请同时填写个人设置里显示的「用户 ID」。留空则用 `sk-` key 尝试，对未上锁的站点照常可用。

### 🔒 安全说明

- 所有 `/api/*`（除登录 / 会话检查）都需有效会话 Cookie；凭据用常量时间比较校验，令牌用 `SESSION_SECRET` 做 HMAC 签名、携带 `edit` 标志、7 天过期。
- 登录后默认只读；解锁编辑（`/api/unlock`）需再次校验密码，服务端才重签 `edit:true` 令牌，写操作在中间件强制拦截（403）。
- 登录与解锁接口按 IP 限流：15 分钟内最多 8 次密码错误，超出后需等待。
- 中转站 API Key 以明文存储在 D1（Cloudflare 对 D1 静态加密，但库内明文）。网站列表只下发脱敏 Key，完整 Key 需登录后按需获取。这是单用户工具在登录门 + HTTPS 下的合理取舍，请勿开放给不受信任的人。
- 会话是无状态签名令牌，退出登录只清除本机 Cookie；如怀疑会话泄露，更换 `SESSION_SECRET` 即可让所有会话失效。
- 请为 `APP_PASSWORD` 用强密码，`SESSION_SECRET` 用足够长的随机串。页面已设 `noindex` 防收录。

---

## 🇬🇧 English

A self-hosted dashboard for monitoring AI API relay stations (New-API / One-API / sub2api / OpenAI-compatible). Bring all your relays onto one screen, test them with a click, and keep an eye on **connectivity, group ratios, available models, and account balances**. Frontend and backend run entirely on **Cloudflare Pages + Functions + D1** — deploy once, run anywhere.

### ✨ Features

- **Multi-site / multi-group**: manage many keys (groups) under each relay station.
- **Real-request liveness**: sends one real `"hi"` request (`max_tokens=1`) with the cheapest model the key can use; **only a genuine completion counts as available**. It adapts to Anthropic `/v1/messages`, OpenAI `/v1/chat/completions` / `/v1/responses`, Gemini native, `max_tokens` parameter mismatches, stream-only endpoints and sub2api "Claude Code only" groups. Failed requests cost no tokens.
- **Four states**: available / no quota (key valid, balance used up) / unavailable (key rejected, or no usable model) / check error (timeout, gateway error, WAF block, upstream rate limit — inconclusive, never reported as unavailable). Expand a key to see every probe request.
- **Ratios and models**: `GET /api/pricing` (New-API/One-API) for the **group ratio** and **per-model ratios**; sub2api uses `GET /v1/sub2api/billing`.
- **Balance (site-level)**: one site = one account. The balance is shown once per site (never multiplied per key); the total is the sum across sites. A failed refresh keeps the last known balance.
- **Ordering**: sites are listed available first, then unavailable; within each group by balance, high to low. Keys inside a site: available first, then by ratio, low to high.
- **Daily auto-test**: the first dashboard open of each day (China time) tests every key not yet tested that day. Each key is auto-tested at most once a day, even with several devices open.
- **Auto provider detection**: infers the provider from the returned model list (GPT / Claude / Grok / GLM / Gemini / DeepSeek / Qwen / Kimi), tags it, and lets you **filter by channel**.
- **Persisted results**: test results are stored in D1, so the last ratios/balance stay visible without re-testing.
- **Single account + password-unlocked editing**: after login you're in **view mode** (test / copy / view balance, read-only); click "Edit" and re-enter the password to unlock **edit mode** for create/update/delete — enforced server-side, not bypassable from the client.
- **UI**: teal dark theme modeled on sub2api, glass cards, stat tiles, a live test progress bar, mobile-friendly.

### 🧱 Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite + Tailwind CSS (built to static assets) |
| Backend | Cloudflare Pages Functions (`/functions/api/*`) |
| Storage | Cloudflare D1 (SQLite) |
| Auth | HMAC-SHA256 signed sessions (HttpOnly / Secure / SameSite=Lax cookie) via Web Crypto |

> All upstream requests are made server-side, avoiding browser CORS. The site list carries only masked keys; a full key is fetched on demand when you click show / copy. Access tokens are never sent to the frontend.

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

**Access token (optional, New-API only)**: some New-API stations gate `/api/pricing` behind login, so the relay `sk-` key gets a 401 and ratios can't be read. Generate a user access token on that station ("Personal settings → Generate access token") and paste it into the site's "access token" field to read group ratios and the account balance (`/api/user/self`); liveness tests still use the `sk-` key. Newer New-API versions also require a `New-Api-User` header with the access token, so fill in the "user ID" shown in personal settings too. Leave it blank to try the `sk-` key, which works on stations that leave pricing public.

### 🔒 Security Notes

- Every `/api/*` route (except login / session check) requires a valid session cookie. Credentials use constant-time comparison; the token is HMAC-signed with `SESSION_SECRET`, carries an `edit` flag, and expires after 7 days.
- After login you're read-only; unlocking edit mode (`/api/unlock`) re-verifies the password before the server re-signs an `edit:true` token, and writes are blocked in middleware (403) otherwise.
- Login and unlock are rate-limited per IP: at most 8 wrong passwords per 15 minutes.
- Relay API keys are stored in plaintext in D1 (Cloudflare encrypts D1 at rest, but rows are plaintext). The site list only carries masked keys; a full key is fetched on demand by a logged-in session. This is a reasonable trade-off for a single-user tool behind a login gate + HTTPS — do not expose it to untrusted users.
- Sessions are stateless signed tokens: logging out only clears the local cookie. If you suspect a session leaked, rotate `SESSION_SECRET` to invalidate every session.
- Use a strong `APP_PASSWORD` and a long random `SESSION_SECRET`. The page is set to `noindex`.

---

<div align="center">

Built with ⚡ on Cloudflare · MIT-friendly for personal use

</div>
