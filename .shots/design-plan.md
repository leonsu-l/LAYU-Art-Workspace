# NanoBanana FE refactor — working plan (temp file, delete before final)

Task (m00001): "使用frontend-design和web-design-guidelines重构当前项目的前端页面" — redesign/refactor the frontend pages with the two design skills (distinctive visual identity + Web Interface Guidelines compliance).

## Direction: 暗房 / THE DARKROOM (contact sheet)

Subject: a one-person AI image studio. Vernacular: darkroom, film base, contact sheet, frame numbers, safelight, sprocket rail, proof print. Signature element = **the contact sheet**: results and history are numbered film frames with a sprocket rail and an amber "grease pencil" selection mark. Structure encodes real sequence (each generation is a numbered frame).

Rejected: current lavender/SaaS look (generic); also avoided the 3 default AI looks (cream+serif+terracotta / near-black+single acid accent / broadsheet hairlines) by using a WARM BROWN film base, a banana-amber primary, a serif CJK display face, and film-strip structure instead of cards.

## Tokens (src/index.css)

```
--film:        #14100C   page (unexposed film base)
--film-raise:  #1B1611   panels
--film-inset:  #221C16   inputs / wells
--film-hover:  #2A231C
--hairline:    #352B22
--hairline-hi: #4C3E30
--paper:       #F4EDE2   primary type (photo paper)
--paper-soft:  #CFC3B0
--ash:         #9C8F7C   muted
--amber:       #EFB03C   brand / safelight / CTA
--amber-deep:  #C98A16   pressed
--proof-red:   #E8755C   errors, delete
--proof-green: #97B07E   succeeded
--font-display: 'Fraunces', 'Noto Serif SC', 'Songti SC', 'SimSun', serif
--font-body:    'Instrument Sans', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif
--font-mono:    'DM Mono', ui-monospace, 'Cascadia Mono', monospace
```

Google Fonts one request: `Fraunces:opsz,wght@9..144,300..700`, `Instrument+Sans:wght@400..700`, `DM+Mono:wght@400;500`, `Noto+Serif+SC:wght@500;600`, `display=swap`, plus `<link rel="preconnect">` to fonts.googleapis.com + fonts.gstatic.com.

Type scale (dark UI, everything ≥ 13px; current design used 9–11px, a defect):
- masthead h1 clamp(34px, 3.9vw, 56px), serif, weight 400, tracking .01em, `text-wrap: balance`
- h2 section 20–22px serif; h3 15–16px body 600
- body/UI 15px / 1.6; meta 13px; mono labels 11.5px letter-spacing .18em UPPERCASE
- mono numerics: `font-variant-numeric: tabular-nums`

## Layout

Home (`src/App.tsx`):
```
[masthead] ROLL 001 · EXPOSURE    h1 今天，想造点什么？     spec: 模型/协议/张数
[rail] sprocket strip
grid ≥1080px:  left 400–440px (bench, sticky-ish)   |  right minmax(0,1fr)
  left:  PromptPanel (曝光台) + ConfigPanel (暗房设置) + storage note
  right: ResultPanel (contact sheet) + TaskRoll (任务胶卷) + notes
mobile: masthead → bench → contact sheet → roll → settings → footer
```
Gallery (`src/pages/GalleryPage.tsx`): masthead → toolbar (select-all / delete-selected / refresh) → contact-sheet grid of frames (numbered, sharp 2px corners, hover amber hint) → `<dialog>` lightbox with dark drop-back.

## Component notes (CSS modules rewritten from scratch, same class names)

- `StudioHeader`: sticky, 1px bottom hairline + sprocket rail; wordmark = banana mark + `nanobanana` in Fraunces + `STUDIO` mono; nav = two film-frame links with amber underline/inset when active.
- `PromptPanel`: panel heading `曝光台 / EXPOSURE`; big textarea (min-height 190px, 16px text, inset bg); idea chips mono; ReferenceImageUpload; primary CTA = full-width amber, dark text, `开始生成` + kbd hint; the button text keeps its existing state machine copy.
- `ConfigPanel`: keep every field/handler as-is; restyle rows to 2-col grid with 13px labels above inputs; `请求预览` stays a `<details>`; API key eye button keeps aria-label; add `name`/`type=url`/`spellCheck=false` where missing.
- `ResultPanel`: contact sheet with top sprocket rail; frames with `FRAME 01` captions and corner ticks; empty state = blank frame + amber note + the still-life `public/studio-still-life.webp` as "proof print" (explicit width/height); error block keeps guidance copy; size warning kept; horizontal scroller `overscroll-behavior: contain`, `tabIndex=0`.
- NEW `src/components/TaskRoll.tsx` + `.module.css`: horizontal film strip of tasks (thumb from `task.result?.images[0].url`, blank frame when pending), mono frame number, status dot/tint, amber ring on selected, per-frame delete button with `aria-label`, horizontal scroll, and the existing hint/warning/error/pending-submission copy rendered above/below the strip. `App.tsx` keeps all handlers, passes them in.
- `GalleryPage`: frame cards keep checkbox/select/download/delete/preview; grid uses `content-visibility:auto`; lightbox `overscroll-behavior: contain`; `<time dateTime>` kept.

## Guideline fixes (web-design-guidelines checklist to verify at the end)

min 13px text · tabular-nums on all counters · `outline` never removed, `:focus-visible` 2px amber + 3px offset · `prefers-reduced-motion` · no `transition: all` · `color-scheme: dark` + theme-color #14100C · explicit `background-color`/`color` on native `<select>` · aria-label on every icon-only button · labels/`htmlFor` everywhere · `…` not `...` · curly quotes for Chinese 「」/“” · skip link to `#main` · heading order h1>h2>h3 · `min-w-0` for truncation · `text-wrap: balance` on headings · `scroll-margin-top` for sticky header · empty states · `overscroll-behavior: contain` in dialog · `touch-action: manipulation` · `content-visibility: auto` for long grids · no layout reads in render.

## Env / verification

- Backend: `npm run dev:server` (works under sandbox), http://127.0.0.1:3001
- Vite: `npm run dev` MUST run with sandbox_permissions=danger-full-access, else `Error: spawn EPERM` in `windowsSafeRealPathSync` (m00071). Serves http://127.0.0.1:5173.
- Headless Chrome also needs danger-full-access (mojo platform_channel denied under sandbox). Binary: `C:\Program Files\Google\Chrome\Application\chrome.exe`, flags `--headless=new --disable-gpu --hide-scrollbars --no-first-run --user-data-dir=$env:TEMP\dsh-chrome-prof --window-size=W,H --virtual-time-budget=8000 --screenshot=...`.
- LESSON: never put the Chrome profile inside the workspace — Vite's watcher dies with `Error: EBUSY: resource busy or locked, watch '.shots\edgeprofile\...\cache.db'` (m00090).
- Baseline screenshot `.shots/before-home.png` (1440x1500). Screenshots dir `.shots/` is temporary — delete at end.
- Build: `npm run build` (tsc -b + tsc -p tsconfig.server.json + vite build); lint `npm run lint`.

## Current files & class inventories (grep `styles\.` per file)

- src/components/StudioHeader.tsx: brand mark wordmark nav navLink active localNote header inner
- src/components/PromptPanel.tsx: panel header heading eyebrow editor textarea srOnly counter overLimit ideas footer hint primaryButton spinner
- src/components/ConfigPanel.tsx: panel header headingRow title status statusDot configured description riskNotice riskContent riskNoticeClose connectionFields protocolGroup label segmented protocolButton field input customField labelHint passwordField passwordInput inlineAction fieldHint paramsSection sectionTitle paramsGrid fullWidthField paramsHint checkboxField previewCard previewSummary previewContent previewToolbar method previewButton endpoint bodyPreview copyNotice
- src/components/ResultPanel.tsx: panel header heading status activeDot clearButton error errorIcon errorHint errorCode emptyCanvas emptyCopy canvasLabel artwork canvasFooter resultMeta successDot model ratio responseText scroller track slot figure skeleton image imageLoaded imageNumber actualSize sizeWarning placeholderCard pendingLabel noImages loadError spinner
- src/components/ReferenceImageUpload.tsx: upload header title usage dropZone dragging dropButton hint error previews preview caption remove
- src/pages/GalleryPage.tsx: pageShell page pageHeader eyebrow titleRow title summary subtitle pageActions secondaryButton primaryButton actionNotice collection loadingState spinner emptyState emptyArtboard artboardLine artboardSpark emptyEyebrow emptyBreak collectionBar collectionLabel batchActions selectLabel batchSummary batchDeleteButton grid card cardSelected cardTopline modelLabel imageButton cardImage imageHint cardMeta cardPrompt metaLine cardActions cardAction deleteAction storageNote previewDialog previewHeader previewTitle closeButton previewCanvas previewImage previewDetails previewMetadata previewEyebrow previewPrompt previewInfo
- src/App.tsx: appShell page pageHeading eyebrow subtitle modeBadge workspace sidebar creationArea storageNote galleryNotice footer footerBrand cacheSummary protocol taskPanel taskHeader taskHeading taskTools taskCount failedCount refreshButton taskHint taskWarning taskError pendingTasks pendingRow taskList taskRow taskItem selectedTask deleteTaskButton taskTopline taskStatus taskMeta taskPrompt spinner
- src/components/Icon.tsx: names sparkles grid arrow-up-right arrow-right chevron-down settings image download trash close check copy eye eye-off plus arrow-left folder loader shield sliders banana (add `film`)

## Facts about data shapes

`GenerationTask {id,status,createdAt,updatedAt,provider,model,prompt,expectedImageCount,expectedAspectRatio,requestedSize?,referenceImageCount?,result?:GenerateImageResult,error?:AppError}`; `GenerateImageResult {provider,model,text?,images:GeneratedImage[],createdAt}`; `GeneratedImage {mimeType,base64Data?,url?}` (tasks store `url`).
