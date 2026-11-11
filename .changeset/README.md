# Changesets

Each pull request that changes the published package (`@senon/webmcp-sdk`) adds a change note here:

```sh
pnpm changeset            # pick the bump (patch / minor / major) and write the changelog text
pnpm changeset --empty    # for changes that need no release (docs, CI, tests only)
```

The text you write becomes the `CHANGELOG.md` entry, so write it for users. While the version is `0.x`, breaking changes are `minor`.

Maintainers turn the pending notes into a version with `pnpm changeset version` (see `docs/releasing.md`).
