# Publishing the infernoflow VS Code extension

One-time setup, then `vsce publish` for each release.

## One-time setup

### 1. Create a Marketplace publisher

Visit <https://marketplace.visualstudio.com/manage/createpublisher>.
The publisher ID in `package.json` is `infernoflow` — that name needs to be
registered to your Microsoft account or you must change `package.json`'s
`publisher` field to one you own.

### 2. Generate a Personal Access Token (PAT)

The Marketplace authenticates via Azure DevOps PATs, NOT GitHub PATs.

1. Go to <https://dev.azure.com>. Create an org if you don't have one (free).
2. Click your avatar (top-right) → **Personal access tokens** → **New Token**.
3. Set:
   - **Organization:** "All accessible organizations"
   - **Expiration:** 90 days (or longer; Microsoft caps at 1 year)
   - **Scopes:** click **"Custom defined"** → tick **"Marketplace → Manage"**
4. Click **Create**. **Copy the token** (you can't see it again).

### 3. Login `vsce` once

```cmd
cd /d C:\Ron\projects\infernoflow-pkg\vscode-extension
npm install
npx vsce login infernoflow
```

It will prompt for the PAT — paste it. The credential is cached in
`%USERPROFILE%\.vsce\` from then on.

## Publish (each release)

After the one-time setup is done:

```cmd
cd /d C:\Ron\projects\infernoflow-pkg\vscode-extension
npm install
npm run compile
npx vsce package        # builds infernoflow-0.7.0.vsix locally to verify
npx vsce publish        # uploads to the Marketplace
```

`vsce publish` reads the version from `package.json`. To bump and publish in
one shot use `npx vsce publish patch | minor | major` instead.

## Verify the listing

After publishing, visit:

```
https://marketplace.visualstudio.com/items?itemName=infernoflow.infernoflow
```

It can take up to 5 minutes for the listing to propagate.

## Common pitfalls

- **PAT scope wrong.** If `vsce` says "401 Unauthorized" or "this account does
  not have permission," your PAT was created with the wrong scope. Recreate it
  with **Marketplace → Manage** ticked.
- **Publisher name mismatch.** `package.json` `publisher` must match the
  publisher you created in the Marketplace. Change the package.json field if
  the publisher you registered uses a different name.
- **README too short.** Marketplace requires the README to be at least a few
  paragraphs. The current README.md in this folder is fine.
- **Icon size.** `media/icon.png` should be at least 128×128. Already set up.
