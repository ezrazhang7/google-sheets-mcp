# Lessons: building MCP servers (from the google-sheets-mcp build, Aug 2026)

Distilled from building a Google Sheets MCP connector end-to-end: TypeScript MCP SDK v2,
dual deployment (local `.mcpb` extension + Cloudflare Worker custom connector), Google
OAuth. The tools worked on the first smoke test; every real failure was in the seams.

## Architecture
- **Map the runtime matrix before writing code.** Local MCP servers do not reach cloud
  Cowork sessions or claude.ai web/mobile — only a publicly hosted remote server does.
  That one fact dictates a dual local/remote design from day one.
- **Prefer `fetch` + WebCrypto over vendor SDKs.** Skipping `googleapis` let one codebase
  run on Node and V8 isolates (Workers) and cut the bundle ~10x (15 MB → 1.7 MB).
- **Inject clients into tool registrations** (no module-level singletons) so config can
  come per-request (Worker bindings) or per-process (env vars) from the same code.

## Packaging (.mcpb / bundles)
- **Test the artifact you ship, not the repo.** Both packaging bugs were invisible to
  tsc and to running from source; only unpacking the built bundle and executing it
  caught them. Always: pack → unpack → run initialize + tools/list against the unpacked copy.
- `.mcpbignore` patterns are gitignore-style and match at ANY depth: a bare `src/`
  strips `node_modules/*/build/src` and guts dependencies. Anchor with leading `/`.
  Directory re-includes (`!/node_modules/foo`) must NOT have trailing slashes — the
  packer prunes directories during its walk, so dir-only negations silently fail.
- **Never map a manifest env var to an optional user_config field without a default.**
  An unset `${user_config.x}` substitution crashes the extension at launch.
- Allowlist runtime deps into the bundle (`/node_modules/*` + `!` negations) rather
  than blocklisting dev deps — adding a large devDependency later silently bloats it.

## Errors are UX
- A stdio server's only voice is tool results. **Write the remediation into the error
  text** (what to click, which console screen, which env var). One such message is what
  eventually led the user to the real fix.
- **Fail fast.** Blocking a tool call on a browser OAuth flow just hits the client's
  ~60s timeout and reads as "broken." Reject in ~20s with instructions; let the flow
  finish in the background; the next call picks up the cached token.
- Convert provider errors to readable messages with status-specific hints (403 → check
  access/scopes, 404 → check the ID, 429 → rate limit).

## OAuth with Google (policy > code)
- **Failures are policy, not code**: Testing-mode apps revoke refresh tokens every 7
  days AND allowlist who may consent (tester 403s). "Publish app" fixes both, needs no
  verification review for personal use (<100 users), and should be step 1 of setup docs,
  not a footnote.
- **The identity chain**: the MCP client's account (Claude login) is irrelevant; the
  server acts as whichever Google account clicks Allow. Authorize as the account that
  owns the data. Multi-account users WILL cross these wires — document it.
- **Make consent self-healing**: detect `invalid_grant`, discard the cached token,
  re-run consent automatically. Never require hand-deleting a cache file.
- Loopback-flow CLIs: browsers hold speculative keep-alive sockets; `server.close()`
  won't drain them. Use `closeAllConnections()` + explicit `process.exit()` after the
  CLI's job, or the process lingers and eats the user's shell input (looks frozen).

## Remote deployment & auth
- **Fail closed**: unset shared secret → 401 everything. Constant-time token compares.
- **Never bet on a platform's happy path**: claude.ai's Request-headers field for
  custom connectors is a gated beta. Support a fallback auth channel (`/mcp/<token>`
  path secret) so the URL field alone is enough.
- Assume credentials leak (they ended up in a screenshot); optimize for rotation:
  scripted mint, `wrangler secret put`, documented revoke link.
- Ship an unauthenticated `/health` and a distinctive 404 string — they double as
  deployment fingerprints you can verify from a user's screenshot.
- Sheets/Drive APIs are free; hard billing guarantee = no billing account on the project.

## Process
- Commit small with honest messages; every fix stays bisectable and revertable (a
  mid-flight direction change was one `git stash`).
- Verify platform claims against live docs/searches, not memory — "needs Google
  verification approval" felt true and was false.
- Reproduce before fixing: stub the failing layer (fake token endpoint, kept-alive
  socket) and confirm the fix under the same stub.
