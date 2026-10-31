# GitOpen 优化计划（2026-10-30 → 2026-11-05）

审查基线是 `main` @ `f0d2f75`（含已合并的 [#1](https://github.com/jimmy1340/gitopen/pull/1)、[#2](https://github.com/jimmy1340/gitopen/pull/2)、[#3](https://github.com/jimmy1340/gitopen/pull/3)）。Day 1 的实现是 [#4](https://github.com/jimmy1340/gitopen/pull/4)（分支 `cursor/day1-request-safety-18b7`），已合并。

- **#1** 限制了 API key 导出、MCP stdio，并给 git proxy 加了私网与重定向校验。`POST /api/github-user` 的 `get_token` 仍会把解析到的 token（含服务器环境变量）返回给未认证调用方；GitLab 路由仍把调用方提供的 `gitlabUrl` 交给 `fetch` 且默认跟随重定向。
- **#2** 是界面与侧边栏修复。本次审查没有发现需要在本周第一天改动的界面回归，后续几天也不做大块 UI 重构。
- **#3** 注入了真实 git 元数据、去掉了热路径上的 LLM 调试输出，并修正了 `pre-start.ts` / `electron:build:renderer`。限流匹配、cookie 解析和 GitLab 出站请求不在那次改动里。`pre-start.cjs` 已无引用，但仍保留旧的 BOLT.DIY 横幅和双重 `JSON.stringify`。

原则：每天只做一小块可审的改动，保持现有成功路径的响应形态；安全边界收紧（拒绝私网 GitLab、不再导出 token）单独写明。不在本周做 DNS 解析来挡 `nip.io` 这类重绑定，也不给 `/api/chat` 加新的限流。

## Day 1 — 2026-10-30（Done）

**状态：Done。** 已合并 [#4](https://github.com/jimmy1340/gitopen/pull/4)。

请求路径上的三处安全/正确性修复。成功的 GitHub 仓库列表、公开 HTTPS GitLab 项目列表，以及合法 cookie 的解析结果保持不变。

### 1. GitLab 出站地址只允许公网 HTTPS

`app/routes/api.gitlab-projects.ts` 与 `app/routes/api.gitlab-branches.ts` 把 `gitlabUrl` 拼进 URL 后直接 `fetch`，并跟随重定向。调用方可以指向 `127.0.0.1`、`169.254.169.254` 或 `10.0.0.0/8`，也可以从公网主机 302 到这些地址。

- 新增 `fetchPublicHttps`（`app/lib/security.ts`）：仅 `https`、拒绝 userinfo、用现有的 `isPrivateOrLocalHost` 拒绝回环/私网/链路本地；`redirect: 'manual'`，每一跳同样校验；跨源时去掉 `Authorization`。
- 分支接口的 `projectId` 只接受 1–20 位数字。设置页传入的是 GitLab 数字 id；`../admin` 这类值会改写路径，现已 400。
- `https://gitlab.com` 与 `https://gitlab.example.org` 仍会请求 `/api/v4/...`，响应字段不变。
- `http://` 与私网地址返回 403 `{ error: 'GitLab URL is not allowed' }`，且不会发出第一跳以外的私网请求。自建在笔记本回环或局域网 HTTP 上的 GitLab 不再经这两个路由访问。

### 2. `get_token` 不再返回任何 GitHub token

`app/routes/api.github-user.ts` 的 `get_token` 在仓库内没有调用方，但会返回 cookie 或 `GITHUB_TOKEN` / `VITE_GITHUB_ACCESS_TOKEN`。该动作现在在读取凭证之前返回 403 `{ error: 'GitHub tokens are not exported by this route' }`。`GET`、`get_repos`、`get_branches`、`search_repos` 仍用原来的 token 去请求 GitHub，响应体里不包含 token。

### 3. 限流规则与窗口按配置生效，并给内存表封顶

`app/lib/security.ts` 的 `checkRateLimit` 用 `Array#find`，而 `RATE_LIMITS` 的第一项是 `/api/*`，因此 `/api/llmcall`（10 次/分钟）、`/api/github-*`（30 次/分钟）、`/api/netlify-*`（20 次/分钟）从未生效。窗口过期后计数也不重置，要再等一个窗口才被清掉。

- 更长的精确或通配前缀优先。`/api/*` 的前缀是 `/api/`，不再误匹配 `/apiculture`。
- `now >= resetTime` 时重新计数。
- 进程内表最多 `4096` 个 key，超出时丢掉最早过期的项。没有规则的路径不写入表。
- 已经包了 `withSecurity` 的路由因此改为按上表限流：GitHub 30 次/分钟，Netlify 20 次/分钟，其余 `/api/*`（含 GitLab、Supabase、Vercel）100 次/15 分钟。未超限时响应体不变。
- `/api/llmcall` 与 `/api/chat` **今天没有**接上 `withSecurity`。表里的 10 次/分钟现在能被匹配到，但这两个路由仍无限流，避免在未统计调用量时切断补全。

### 4. 损坏的 cookie 不再把路由打成 500

`app/lib/api/cookies.ts`：`decodeURIComponent` 失败时跳过该对、保留其余 cookie；`apiKeys` / `providers` 不是对象或 JSON 非法时当作 `{}`；忽略名为 `__proto__`、`prototype`、`constructor` 的名字。合法 cookie（含值里的 `=`）解析结果不变。`get_repos` 在 `apiKeys` 损坏时继续使用服务器 token。

### 验收

- `pnpm test` 覆盖 `app/lib/security.spec.ts`、`app/lib/api/cookies.spec.ts`、`app/lib/api/github-user.spec.ts`、`app/lib/api/gitlab-routes.spec.ts`。
- `pnpm typecheck` 与 `pnpm lint` 通过。
- 手工：`POST /api/gitlab-projects` body `{ "token": "...", "gitlabUrl": "https://127.0.0.1" }` 为 403 且无出站；`gitlabUrl` 为 `https://gitlab.com` 时仍请求 GitLab。`POST /api/github-user` `{ "action": "get_token" }` 为 403，响应文本不含 token。

### 涉及文件

- `app/lib/security.ts`、`app/lib/security.spec.ts`
- `app/lib/api/cookies.ts`、`app/lib/api/cookies.spec.ts`
- `app/routes/api.gitlab-projects.ts`、`app/routes/api.gitlab-branches.ts`、`app/lib/api/gitlab-routes.spec.ts`
- `app/routes/api.github-user.ts`、`app/lib/api/github-user.spec.ts`

## Day 2 — 2026-10-31（Done）

**状态：Done。**

校验拼进 GitHub API URL 的仓库坐标，避免路径注入。不改 GitLab（Day 1 已限制 project id 与主机）。`owner` 与 `name` 只允许 `[A-Za-z0-9_.-]`，拒绝空格、`?`、`#`、`..`，以及会被 URL 解析器丢掉的 `.` 段。非法值返回 400，且不会带 token 出站。

- `app/routes/api.github-user.ts` 的 `get_branches`：`repo` 必须是 `owner/name`，字符集 `[A-Za-z0-9_.-]`，拒绝空格、`?`、`#`、`..`。
- `app/routes/api.github-branches.ts`：`owner` 与 `repo` 用同一规则后再请求 `/repos/{owner}/{repo}`。
- `app/routes/api.github-template.ts`：`repo` 查询参数同样校验；非法值 400，不带 token 出站。
- 验收：`owner/repo` 仍 200（mock）；`../x`、`foo/bar?x` 为 400 且 `fetch` 未被调用。现有合法卡片的克隆与分支列表行为不变。

### 涉及文件

- `app/lib/api/github-coordinates.ts`、`app/lib/api/github-repo-routes.spec.ts`
- `app/routes/api.github-user.ts`、`app/routes/api.github-branches.ts`、`app/routes/api.github-template.ts`
- `app/lib/api/github-user.spec.ts`

## Day 3 — 2026-11-01

给 GitHub 统计加页数上限，避免 `while (hasMore)` 在大账号上无限翻页，并降低分支请求的并发。

- `app/routes/api.github-stats.ts`：仓库列表最多 10 页（1000 条）。不足 100 条时仍提前结束。响应字段保持 `GitHubStats`。
- 分支计数维持“只看前 50 个仓库”，但改为有限并发（例如 5），而不是 `Promise.allSettled` 一次打满。
- 验收：mock 持续返回 100 条时 `fetch` 次数有上界；小账号（1 页）的 JSON 形状与现在一致。

## Day 4 — 2026-11-02

减少未认证诊断接口的出站，并收紧限流用的客户端 IP。

- `app/routes/api.system.diagnostics.ts`：对 `https://api.github.com/zen` 与 `https://api.netlify.com/api/v1/` 的探测加短 TTL 缓存（建议 60 秒），同一进程内重复调用不再每次都打外网。响应仍包含 `externalApis.github` / `netlify` 的可达性字段，不返回任何 token。
- `app/lib/security.ts` 的 `getClientIP`：优先 `cf-connecting-ip`。仅当部署显式设置受信代理时才采用 `x-forwarded-for` / `x-real-ip`，否则同一进程内未带 CF 头的请求共用一个桶，避免调用方自造 IP 撑满 4096 个 key。
- 在统计 `selectStarterTemplate` 的调用次数之后，让 `/api/llmcall` 使用已经写好的 10 次/分钟规则。不要把同一限制套到 `/api/chat`。
- 验收：诊断接口第二次命中缓存时 `fetch` 不再增加；伪造 `x-forwarded-for` 不能换新桶（在未开受信代理时）；llmcall 超限返回 429，阈值内响应不变。

## Day 5 — 2026-11-03

错误响应与查询参数里不再带出凭证或堆栈。

- `app/routes/api.supabase.query.ts`：`projectId` 限制为 Supabase 项目 id 字符集；500 响应去掉 `stack`；日志不打印完整 SQL。成功时仍原样返回查询结果。
- `app/components/chat/VercelDeploymentLink.client.tsx` 与 `app/routes/api.vercel-deploy.ts`：GET 查询串中的 `token` 改为请求头或 POST body，避免 token 进入访问日志。部署 URL 的解析结果不变。
- 验收：非法 `projectId` 为 400；故意失败的查询响应 JSON 不含 `stack`；Vercel 回退请求的 URL 不含 `token=`。

## Day 6 — 2026-11-04

Electron 静态资源路径不能靠 `startsWith` 判断是否越界。

- `electron/main/utils/serve.ts` 的 `serveAsset`：`path.join(assetsPath, pathname)` 在 `assetsPath` 为 `/app/assets`、pathname 为 `/../assets-evil/secret` 时会得到 `/app/assets-evil/...`，`startsWith('/app/assets')` 仍为真。
- 抽出不依赖 Electron 的纯函数（例如 `resolveAssetPath(root, pathname)`）：`path.resolve` 之后必须仍落在 `root + sep` 下，拒绝目录前缀兄弟路径。
- 验收：单元测试覆盖根目录内文件、`..`、前缀兄弟目录、绝对路径；目录内文件仍返回可读流。不改窗口或打包配置。

## Day 7 — 2026-11-05

收掉 #3 之后还留着的重复与热路径日志。不改构建出来的 git 元数据内容。

- 删除无引用的 `pre-start.cjs`（`package.json` 的 `dev` 已使用 `pre-start.ts`）。确认仓库内没有脚本再调用它。
- `app/routes/api.chat.ts` 删除本地 `parseCookies`，改用 Day 1 的 `app/lib/api/cookies.ts`。损坏的 `apiKeys` cookie 不再让聊天接口 500；合法 cookie 解析结果一致。
- `app/routes/api.git-proxy.$.ts` 去掉每次请求的 `console.log`（目标 URL、头名、状态）。现有 `app/lib/api/git-proxy.spec.ts` 继续通过，且日志断言仍然不包含 `Authorization` 的值。
- `app/routes/api.system.git-info.ts` 读取 `githubToken` / `githubUsername` 时改用 `parseCookies`，避免 token 值中的 `=` 被 `split('=')[1]` 截断。用户名仍须匹配 `^[A-Za-z0-9-]+$`。
- 验收：`node pre-start.ts` 仍打印 `v1.0.2` 与短 hash；`pnpm test` 通过；代理与 git-info 的响应形状不变。
