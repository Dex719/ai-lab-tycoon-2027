# Оболочка для Windows и macOS

Electron-окно с игрой: `app/main.cjs` (режим экрана, разрешение, монитор, масштаб), `app/preload.cjs` (мост `window.aiLabDesktop` для `src/ui/desktop.ts`).

## macOS

Собирается в GitHub Actions (`.github/workflows/mac.yml`) на каждый push с изменениями игры или оболочки, вручную - кнопкой Run workflow. Результат - артефакт `AI-Lab-Tycoon-mac` с двумя образами:

- `AI-Lab-Tycoon-mac-Apple-Silicon.dmg` - Mac на M1, M2, M3, M4;
- `AI-Lab-Tycoon-mac-Intel.dmg` - Mac на Intel.

Подписи Apple пока нет. Первый запуск: перетащить игру в «Программы», открыть - Mac скажет, что разработчик не проверен. Затем «Системные настройки» → «Конфиденциальность и безопасность» → «Всё равно открыть». Если Mac пишет «приложение повреждено», в Терминале:

```bash
xattr -cr "/Applications/AI Lab Tycoon.app"
```

Для подписи нужен Apple Developer Program ($99 в год): сертификат Developer ID Application и нотаризация, их добавим в сборку секретами репозитория.

## Windows

Пока собирается вручную на Windows: `npx vite build --base=./ --outDir desktop/app/dist --emptyOutDir`, затем в `desktop` - `npm install`, `node make-icons.mjs` и `npx @electron/packager app "AI Lab Tycoon" --platform=win32 --arch=x64 --out=out --overwrite --asar`.
