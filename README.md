# Bortlesboat.github.io

Source for the Bortlesboat personal site and public project demos.

Live site: https://bortlesboat.github.io/

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The site is built with Vite. Public demos and generated static assets live under `public/`, while project metadata used by the main site lives in `src/data/projects.json`.

## Search discovery

`public/robots.txt` advertises the sitemap at `https://bortlesboat.github.io/sitemap.xml`.
Register that sitemap in Bing Webmaster Tools for crawl reporting. Account setup
is separate from this repository's deployment.

After a successful production deployment from `main`, the workflow sends the
sitemap's HTML pages to [IndexNow](https://www.indexnow.org/documentation).
Machine-readable JSON/text resources are excluded. The script checks that the
production host serves the exact root key file before making one submission to
`https://api.indexnow.org/indexnow`. It never submits during pull request builds.

Preview the batch without making any network requests:

```bash
npm run indexnow
```

After deployment, a manual notification is available with `npm run indexnow -- --submit`.
HTTP 200 confirms receipt; HTTP 202 means key validation is pending. Neither
guarantees crawling or indexing. Errors fail the notification job without
undoing the completed deployment. Investigate the result before retrying; the
script uses request timeouts and does not automatically retry uncertain sends.
