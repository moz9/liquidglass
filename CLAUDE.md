@AGENTS.md

После правок этого репозитория выполняй `node tools/check.mjs`; `--write` используй для пересоздания производных файлов при изменении их источников. Изменённое поведение web-примеров проверяй в demo и визуально по правилам AGENTS.md: `node tools/visual-check.mjs <url> --out shots` и `node tools/material-check.mjs <url>` (нужен Playwright с Chromium: `npm i -D playwright && npx playwright install chromium`).
