# MCP setup, updates, and rollback

## Published package or local checkout

The published stdio setup launches `npx -y @meshy-ai/meshy-mcp-server`. An unversioned package can change on a later launch. For reproducibility, replace the package argument with `@meshy-ai/meshy-mcp-server@<reviewed-version>` and record the selected version. A fork's unpublished changes are not present in the npm package.

For a reviewed local checkout:

```bash
npm ci
npm run lint
npm test
```

`npm test` builds the server before running Node's offline tests. Configure the client with an absolute Node executable if its environment does not provide Node on PATH, and an absolute path to the built entry point:

```json
{
  "mcpServers": {
    "meshy": {
      "command": "node",
      "args": ["/absolute/path/to/meshy-mcp-server/dist/index.js"]
    }
  }
}
```

Supply `MESHY_API_KEY` through the client's secret/environment facilities or inherited process environment. Some clients require an explicit `env` block; use their documented secret-reference syntax instead of copying real keys into shared examples. Never put keys in launch arguments, commits, screenshots, PR descriptions, or logs. Keep machine-local configuration and `.env` files untracked. The default transport is stdio; do not enable HTTP merely to test setup.

Starting the process alone does not prove the client loaded its tools. Restart/reconnect the server in the client, then inspect its advertised tool schemas in a new session. Schema discovery does not generate models or require a paid API request. Confirm that generation advertises `meshy-7.1`, text-preview `meshy-t2`, and endpoint-appropriate `geometry_resolution` values. Do not use generation as a connection smoke test.

## Update checklist

1. Record the current Git commit (`git rev-parse HEAD`) or pinned npm version, launch configuration, and Node version. Back up credentials privately, not in this repository.
2. Check `git status --short` before changing a local checkout. Do not overwrite uncommitted work or rebuild files while a client is using that checkout.
3. Fetch upstream, inspect its changes, and choose a reviewed tag/commit. Merge or rebase in a development branch according to the fork's contribution workflow; do not blindly reset a working installation to `main`.
4. Compare the current Meshy endpoint docs with model enums, schema descriptions, request types, request forwarding, server instructions, and README. `latest` is a moving API alias, separate from the MCP package version.
5. Run `npm ci`, `npm run lint`, and `npm test`. The latter includes `npm run build`. Review `git diff --check` and the intended diff. No API key is needed for these tests.
6. Only after approval, update the client's launch entry or installed checkout, reconnect the server, and start a new session to refresh cached schemas. Record the installed revision and discovery result.

Dependencies are installed from the lockfile. Review security advisories separately; do not use `npm audit fix --force` as routine maintenance. Never patch resolved files in `~/.npm/_npx`, `node_modules`, or built `dist` output instead of source.

## Model-contract maintenance

Keep generation endpoint contracts separate. Text preview and single-image support T2 Smart Topology; multi-image does not. Text T2 rejects quads and targets 100–15,000 faces. Standard geometry controls require Meshy 7.1/latest, with multi-image limited to standard/2k. Refine should inherit its preview model unless explicitly overridden.

When Meshy changes the API:

- Update `src/constants.ts`, the relevant endpoint schemas, request interfaces, and handler forwarding together. Avoid using a global model enum as evidence that every endpoint accepts a model.
- Preserve explicit `false` options, avoid inserting model-specific defaults into unrelated routes, and reject invalid combinations before posting. Keep deprecated compatibility behavior intentional and documented.
- Add focused mocked-request regression tests under `tests/`. They register the real generation handlers with a fake client and inspect request bodies. They must not instantiate a real API client, fetch remote images, or submit paid tasks.
- Run the existing CI matrix (Node 18/20/22). Update tool descriptions, server instructions, README, and release notes where applicable. Publishing remains a separate maintainer-controlled action.
- Recheck official API pricing before quoting or approving paid work. Passing offline tests proves local routing, not live API acceptance, output quality, or current prices.

References: [text-to-3D](https://docs.meshy.ai/en/api/text-to-3d), [image-to-3D](https://docs.meshy.ai/en/api/image-to-3d), [multi-image-to-3D](https://docs.meshy.ai/en/api/multi-image-to-3d), [pricing](https://docs.meshy.ai/en/api/pricing).

## Rollback checklist

- Stop/disconnect the client server first.
- Restore the previously recorded package version or checkout commit. For a local build, keep a separate known-good checkout or switch a clean deployment checkout to the recorded commit, then run `npm ci`, `npm run lint`, and `npm test` to rebuild `dist`. Do not use a destructive reset on development work.
- Restore the previous launch entry if its path changed. Reconnect and open a new session, then inspect tool schemas again.
- Record the failed revision and symptoms without secrets. Investigate before attempting another update; rollback does not cancel previously submitted remote tasks.
