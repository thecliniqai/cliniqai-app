# M0 report route-JS section, before (plan base ba69ebd script) and after (06-07), same clean build (worktree at 87dc215, BUILD_ID FUuw6Nco310ZwwUEH_jy-)

## before: route-js.json
{
  "commit": "<HEAD>",
  "available": false,
  "routes": []
}

## before: README section 3
## 3. Route JS (first load, gzip)

_`.next/app-build-manifest.json` not found: run `npm run e2e:build` first._

## after: README section 3
## 3. Route JS (first load, gzip)

Method: Turbopack manifests (build-manifest.json rootMainFiles ∪ each page_client-reference-manifest.js entryJSFiles), gzip -9 per distinct file, kB = 1024 bytes; not comparable 1:1 with the M0 webpack numbers (app-build-manifest.json page + enclosing layouts).

Framework root (every route): 128.8 kB gz.

| Route | First-load JS (kB gz) | Route-specific (kB gz) | Files | Budget (kB) | Status |
|---|---|---|---|---|---|
| `/` | 158.3 | 29.4 | 11 | 200 | ok |
| `/billing/register` | 158.3 | 29.4 | 11 | 150 | over |
| `/billing/reports` | 164.4 | 35.5 | 12 | 150 | over |
| `/cabin` | 164.7 | 35.8 | 12 | 150 | over |
| `/calendar` | 186.1 | 57.3 | 14 | 150 | over |
| `/clinic/new` | 144.5 | 15.7 | 9 | 150 | ok |
| `/consultation/[id]` | 213.0 | 84.2 | 14 | 200 | over |
| `/forgot-password` | 234.6 | 105.8 | 11 | 150 | over |
| `/join` | 227.0 | 98.2 | 11 | 150 | over |
| `/login` | 234.3 | 105.5 | 12 | 150 | over |
| `/patients` | 161.7 | 32.8 | 12 | 150 | over |
| `/patients/[id]` | 195.5 | 66.7 | 14 | 150 | over |
| `/patients/new` | 177.0 | 48.2 | 13 | 150 | over |
| `/profile` | 183.1 | 54.3 | 13 | 150 | over |
| `/queue` | 188.6 | 59.8 | 14 | 150 | over |
| `/r/[token]` | 133.4 | 4.6 | 8 | 150 | ok |
| `/referrals` | 164.2 | 35.4 | 12 | 150 | over |
| `/reports/view` | 133.4 | 4.6 | 8 | 150 | ok |
| `/reschedule/[token]` | 138.9 | 10.1 | 8 | 150 | ok |
| `/settings/billing` | 158.3 | 29.4 | 11 | 150 | over |
| `/settings/clinic` | 170.2 | 41.4 | 12 | 150 | over |
| `/settings/developer` | 169.0 | 40.2 | 12 | 150 | over |
| `/staff` | 169.3 | 40.5 | 12 | 150 | over |
| `/visits` | 167.1 | 38.3 | 12 | 150 | over |

