# Marine Names

A coastal reference desk for scientific names. Look up any scientific name or AphiaID in the **World Register of Marine Species (WoRMS)**, resolve synonyms to the accepted name, and inspect the classification, reported distributions and literature sources.

**Published tool:** https://coolcode.ca/marinenames/

**Repository:** https://github.com/jsdyer/marinenames

<!-- coolcode:guide -->
Search any scientific name or AphiaID; enable prefix matching to explore a genus and load additional pages. Four dated coastal examples open immediately, and are starting points rather than a search restriction. The record distinguishes accepted names from synonyms and alternative representations. It shows the source’s modification date separately from the retrieval date; synonyms are current relationships, not a historical change timeline. Distribution records are incomplete and do not establish present-day occurrence. Download the selected record as JSON or its name fields as CSV; import an earlier JSON export locally. Expand saved coverage in `web/config.json`, run `python3 scripts/refresh.py`, then commit the new capture, manifest and configuration. No registration or API key is required.
<!-- /coolcode:guide -->

## Use the tool

- Enter a scientific name, such as `Mytilus edulis`, or a positive numeric AphiaID. Exact matching is the default. Prefix search is explicit, rather than firing requests as you type.
- Marine-only and living-only filters apply to name searches. An AphiaID directly retrieves that record regardless of these name-search filters.
- Select a result to load its classification, other names, reported distributions and sources. A link and a fresh-lookup button lead from a synonym to its accepted name.
- Initial search and synonym pages contain at most 50 provider records. **Load next 50** follows the API’s `offset` parameter; the tool does not impose a fixed number of species.
- Saved examples are genuine WoRMS responses, collected on the dates printed beside the record. The capture selector reads all entries from `web/data/index.json`. Each new refresh retains earlier captures with their original coverage.
- **Save record JSON** preserves the selected complete record plus its retrieved date and section errors, if any. **Save name CSV** exports its identifying name fields, status, source URL and dates. Imports stay in this tab and do not send a file to WoRMS.

## Expand or customize

1. Edit `web/config.json`. Add objects to `startingNames`, for example:
   ```json
   {"name": "Patella vulgata", "label": "Common limpet"}
   ```
   `label` is your optional shelf label, not a new taxonomic claim. Any number of selected names can be configured; use a small personal selection, not a whole-register harvest. Arbitrary visitor searches already work without editing this list.
2. The same config holds `marineOnly`, `extantOnly`, `timeoutMs`, `requestGapMs` and `maxImportBytes`. Request spacing has a minimum of 1,000 ms as a conservative application choice, not a claimed WoRMS rate allowance. The documented provider page does not publish a numeric API quota. The API base is validated against the official HTTPS service.
3. Run `python3 scripts/refresh.py` from this repository. It reads all configured exact names, fetches each evidence section and follows synonym pagination. If any source fetch or validation fails, it exits without replacing the current manifest. Successful refreshes add a uniquely named JSON file in `web/data/captures/` and prepend its entry to `web/data/index.json`; earlier files remain unchanged.
4. Run the checks below. Review the new JSON, dates and source citations. Commit `web/config.json`, the newly created capture and `web/data/index.json`. Do not commit `dist/`.
5. Push the reviewed change to `main`; **Marine Names · Check and publish** builds and deploys GitHub Pages. The default build makes no network requests. You can run that workflow manually to republish committed files; it does not refresh WoRMS. No scheduled harvesting is configured.

The app’s layout and interaction code are `web/index.html`, `web/style.css`, `web/app.mjs`; API input handling, provenance validation, CSV and response adapters are in `web/model.mjs`. Metadata for the CoolCode catalogue is `tool.json`.

## Sources, attribution and limits

- [WoRMS webservice](https://www.marinespecies.org/aphia.php?p=webservice) explicitly supports resolving accepted names, synonyms, classifications, sources and distributions for other applications. [REST API documentation](https://www.marinespecies.org/rest/) and [OpenAPI schema](https://www.marinespecies.org/rest/api-docs/openapi.yaml) describe the operations used here.
- **No registration or API key is required** for these public REST lookups. WoRMS asks application authors to let `info@marinespecies.org` know about use of the service so they can add the application to their user list. This is a notification request, not a key gate. This project has not sent that email on your behalf.
- [WoRMS terms and citation guidance](https://www.marinespecies.org/about.php#terms): page text is CC BY unless individually stated otherwise. The entire database must not be redistributed without prior written agreement; this app only keeps a small configurable set of selected name records. It includes no WoRMS photographs, whose default image license differs.
- **WoRMS Editorial Board (2026). World Register of Marine Species. Available from https://www.marinespecies.org at VLIZ. doi:10.14284/170.** The app preserves the individually authored citation supplied with each taxon, including MolluscaBase attribution where returned. Access/retrieval dates are displayed with the record.
- A record’s `modified` date is not the date an organism was observed and not necessarily the date its name changed. Synonym status and relationships are a current snapshot, not a reconstruction of historical taxonomy.
- Distribution records preserve locality, parent geography, record status, review quality, establishment/occurrence and invasiveness where supplied. Missing values remain unknown. A zero count means no distributions were returned for that name; it does not mean the species has no geographic range. No map or inferred coordinates are manufactured.
- Some evidence requests may fail independently. The main name record stays usable, affected sections are explicitly marked unavailable, and the exported receipt keeps those errors. A failed search preserves the prior results. There is no proxy or anti-bot challenge bypass; the app links to the original provider.

Live name lookup was checked on 2026-11-23: HTTP 200, JSON, `Access-Control-Allow-Origin: *`. The saved specimens were fetched from all four evidence endpoints on that date. Actual browser checks are performed separately; API availability can change.

## Privacy

An explicit live lookup sends the name or ID and the visitor’s network connection information to WoRMS. API requests omit credentials and referrer information. No API secrets exist in the application. Saved snapshots load from the same site. Search results and imported records are kept in memory only; reload clears them. Clicking an external source opens its website. CoolCode’s shared anonymous visit counter remains part of the standard template.

## Check and build

Requires Python 3.12+ and Node 24 in CI; no application dependencies.

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
```

These checks validate arbitrary input, expanded configuration, pagination, source errors, date/provenance handling, safe CSV, import schema and an offline build. CI installs its test-only Playwright dependency and runs `python3 tests/browser_smoke.py` against recorded real-provider fixtures. It checks working searches, error retention, exports/imports, safe text rendering and 390 px layout without sending CI traffic to WoRMS. Preview `dist/` through the project’s managed preview workflow.
