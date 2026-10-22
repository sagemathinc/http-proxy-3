# Releasing http-proxy-3

Releases use `.github/workflows/publish.yml` and npm Trusted Publishing (OIDC).
No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. Do not add one as a fallback.

## One-time setup

1. Merge the publishing workflow and dependency security updates (PR #65).
2. Configure the GitHub repository environment **npm** with `williamstein` as a
   required reviewer and restrict deployments to the **main** branch. This is a
   separate approval from merging code. Allow the initiating reviewer to approve
   their own deployment if they are the sole release maintainer.
3. Open [the npm package settings](https://www.npmjs.com/package/http-proxy-3/access)
   and add a GitHub Actions trusted publisher with these exact fields:

   | Field                | Value                                |
   | -------------------- | ------------------------------------ |
   | Organization or user | `sagemathinc`                        |
   | Repository           | `http-proxy-3`                       |
   | Workflow filename    | `publish.yml`                        |
   | Environment          | `npm`                                |
   | Allowed action       | Direct publishing with `npm publish` |

   The default stage-only permission is not sufficient for this workflow.
   Configure trust shortly before the first release: npm currently expires a
   new trust configuration if no successful publish occurs within two days.

4. After a successful OIDC release, consider disabling token-based publishing
   in npm's package settings and revoke any obsolete automation tokens.

The npm-side registration must be done by an authorized npm package maintainer.
Creating the GitHub workflow alone does not establish that trust. Follow
[npm's current trusted-publisher instructions](https://docs.npmjs.com/trusted-publishers/)
when configuring the package.

## Publish a release

1. Review and merge the release changes, including a new stable `package.json`
   version. The version must not already exist on npm. This workflow does not
   bump versions, merge PRs, move tags, or create GitHub releases.
2. Open **Actions > Publish npm package > Run workflow**, select **main**, enter
   that version, and leave **dry_run** enabled for an initial rehearsal.
3. Inspect the build/test results and the `npm-package` artifact. The workflow
   runs a full audit, builds, and tests both proxy paths on Node 22, 24, and 26.
   It packs the Node 24 build. External-network reverse-proxy tests are not
   enabled; the CI checks replace the local `prepublishOnly` hook.
4. Run the same workflow with **dry_run** disabled. Approve the **npm**
   environment deployment after reviewing the run's commit and version.
   All three validation jobs must pass before publishing becomes eligible.
5. Verify the published version and provenance on npm. Refresh downstream
   lockfiles to adopt dependency fixes; a repository merge alone does not
   update installed consumers.

CLI equivalent (use the approved release version):

```sh
gh workflow run publish.yml --repo sagemathinc/http-proxy-3 --ref main \
  -f version=2.0.2 -F dry_run=true
# Only after reviewing the rehearsal and authorizing the actual release:
gh workflow run publish.yml --repo sagemathinc/http-proxy-3 --ref main \
  -f version=2.0.2 -F dry_run=false
```

The workflow checks out the exact commit that triggered the run. It only runs
from this repository's `main`, accepts stable versions only, and does not
publish automatically on pushes or PRs. Validation has no OIDC permission.
The separate publishing job downloads that run's tested tarball and publishes
it without executing package scripts or installing project dependencies.
It uses GitHub-hosted runners, as required by npm Trusted Publishing.

If publishing fails, inspect the error before retrying. npm versions are
immutable: if the version already exists, verify that published artifact
instead of blindly rerunning. Fix a bad release with a new patch version.
