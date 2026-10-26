# Closr Journal Studio

## Product flow

- **My Journal** (`memories.html`) is account-private. **Our Journal** (`our-journal.html`) is a separate shared page. A partner invitation does not publish private pages, folders or photos.
- Create folders, browse pages, or open Important dates. Date creation starts with a calendar, then a description and optional heading. Checking **I’d like to journal this day, too** opens the editable page after the date is saved.
- Details has **A day / A period** controls. A period uses a two-month range calendar with start/end clicks, mouse drag selection, month navigation and direct date fields. Folders are optional library organization; the editor no longer asks for one.
- Tap an empty frame to open the selected-photo picker. Postcard captions and text are editable directly on the page. The memory heading/story synchronize with Details and the journal card; template date labels synchronize with the date range. **Add a little story** inserts and focuses a text box on the page. Text has its own drag handle so typing and moving do not compete.
- The new frame menu offers **Postcard** or **Edge to edge**. Postcards have a compact caption control and a directly editable caption below the image. Older saved rounded/arch/circle/film frames remain readable; the Circle choice was removed from the new frame menu.
- Dragging a photo automatically moves it to the front. Layer controls remain for explicit ordering. Uploads into a chosen frame preserve its layout; bulk uploads arrange the first selection and leave subsequent manual positioning intact.
- Original templates: Postcards, Editorial, Film diary, and Blank. Photos fit frames automatically; **Arrange beautifully** is a deterministic layout operation, not an AI call. Captions, crop position, fonts, colours, paper, layers, rotation, movement, resizing, decorations, straight lines, and undo/redo remain editable.
- A page supports 100 photo frames and 300 total elements. Dense layouts use borderless images to keep dimensions usable. **Save page** is explicit. Unsaved edits prompt on exit; saves in another window cause a revision conflict, with **Save a copy** available rather than overwriting that version. Trash is recoverable; it does not purge data or photos.
- Private weekly/monthly reflection is a factual count of recorded feelings and selected excerpts. It does not infer emotions.

## Custom arrangements and trip pages

**Arrange beautifully** remains deterministic. **Custom**, beside it, accepts supported local instructions for heart, monument/arch, grid or timeline layouts. Unsupported instructions explain that the AI designer is not connected; no photo or prompt is sent to an AI service. Original templates are built in; no Canva code, assets or templates were copied/imported.

**Photos → Make trip pages** reviews the selected photos and offers one trip page or separate daily pages. In the browser, a bounded local JPEG EXIF parser reads capture-date tags before re-encoding; it does not read GPS. Native date/favourites imports use the date supplied by the phone library. Unsupported or stripped metadata remains unknown and requires an explicit date for daily pages, rather than treating upload/file-modification time as capture time. A bulk control can explicitly assign one chosen day to all undated photos. Whole-trip mode can retain undated photos and use the page’s selected period. Photo dates can be corrected in the inspector or trip review. No timestamp is proof of where the user was.

Daily groups allow individual headings/stories and optional grouping in a trip folder. **Create daily pages** explicitly saves them; whole-trip mode updates the current editable draft and still requires **Save page**. Daily saves are sequential, with completed days retained on failure; retry requests reuse stable creation UUIDs and exact page payloads. The backend returns an existing page only when the authenticated creator, scope and full validated content match. It rejects reused identifiers with changed content. Originals/other journal pages are never silently replaced.

Google Photos cloud selection, Google Drive albums, Apple Maps/Google Maps location history, Canva template import, AI vision-based curation and automatic travel narratives are **not connected**. The regular system picker may expose a user's installed cloud photo provider, but this is not background account access. An authorized integration and explicit source selection are needed before claiming those features. No raw coordinates or location-history permission were added.

## Storage and authorization

Migration `0004_journal_studio.sql` adds folders, pages and page/media references, and imports existing private entries, shared journal entries, and important dates with their original privacy scope, authorship and photos. Shared Closr notes remain in their existing table and can be opened from Our Journal. Legacy journal creation/deletion routes direct old clients to reload instead of creating a second divergent journal.

Every journal API requires Google authentication. Private access uses the authenticated user ID; shared access requires membership in that couple. Pages cannot switch scope, and attached photos must belong to the same private account or shared space. Shared writes require a connected partner. There is no endpoint to publish a private folder or private page to the partner.

Library requests are paginated (24 pages) and return compact preview designs rather than every canvas element. The editor fetches one complete page at a time. Uploads have a per-account 120/minute limit; app API limits still apply. Page bodies are capped at 512 KB and designs at 450 KB. These are per-instance controls, not the shared rate limiter still needed before wider launch. Photo uploads are compressed and re-encoded to JPEG before upload; the server validates image signatures and a 1.2 MiB maximum. GCS objects remain private. Explicitly discarded, unreferenced uploads are cleaned up where possible; interrupted uploads/closed tabs can leave unreferenced assets until account deletion. Account deletion removes the member's uploaded objects and dependent journal records.

PNG download is available on the web. It resolves authenticated image data through the journal API to avoid exporting a tainted canvas. Native image export is not enabled in this version.

## Phone gallery import

An app-local `ClosrPhotoLibrary` bridge uses PhotoKit on iOS and MediaStore on Android. It is registered in the native entry points, not downloaded from a remote script.

- Invoked only from **Photos by date or favourites** in a native build. The web uses the regular selected-file picker.
- Requests photo read access at that action, respects limited access and hidden-photo filtering, and previews at most 120 permitted images from a range of up to one year. Narrowing dates finds additional photos.
- Favourites refer to the phone library's favourite metadata. Android favourites filtering needs Android 11 or newer; cloud/gallery providers may expose different favourite information. Standard photo selection remains available.
- Thumbnails and local identifiers stay on-device. Only explicitly selected photos are re-encoded and uploaded after **Add selected photos**. Native reads are restricted to identifiers returned by that preview.
- Quick selection ranks by favourites and resolution, without AI. It does not claim to understand the photo's meaning or choose emotionally important moments.
- Native source and asset synchronization are prepared; permissions, cloud-only images, orientation and device behaviour still need signed-build checks on real Android and iPhone devices. Broad photo-access eligibility and the store privacy declarations must be reviewed before public distribution.

## Optional writing formatter

`POST /api/journal/polish` uses the existing server-side `OPENAI_API_KEY` and `OPENAI_FORMATTER_MODEL` (falling back to the app's `OPENAI_MODEL`). It requests structured title/description output through the Responses API, with `store: false`, response length validation, a timeout, and per-user minute/day limits. No key reaches the browser.

The preview dialog explains that the selected title and text go to OpenAI; no photos, other entries, partner conversations or journal history are sent by this operation. A rewrite keeps facts, language, perspective and emotional meaning. **Use these words** is required before applying it, and canvas undo remains available.

The staging backend has no OpenAI key configured yet, so the formatter is visibly unavailable. Layout, writing, photo arrangement and saving work independently. Vision-based photo curation and handwriting recognition are not implemented.

Spotify work is on hold at the user's request and is not part of this deployment.
