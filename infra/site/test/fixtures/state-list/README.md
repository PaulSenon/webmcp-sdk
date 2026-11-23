Real `alchemy state list` output, alchemy 2.0.0-beta.85 (`ALCHEMY_PLAIN=1`, `--backend local`
on a throwaway `.alchemy/state/example-site/{pr-6,pr-16,production}`, captured 2026-11-23). The
listing format comes from `State/Tree.js` `listState`, shared by every backend (HTTP included);
the update-check WARN line is printed on stdout too.
- `root.txt`: `alchemy state list` (no path) — the store root: stacks only (what v0.4.0 parsed).
- `stack.txt`: `alchemy state list example-site` — what the sweep lists since v0.4.1.
