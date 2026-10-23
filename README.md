# Edge Delivery Authoring
This repo provides the author experience for https://da.live.

## Developing
### Run
1. Clone this repo to your computer.
1. Install the [AEM CLI](https://github.com/adobe/helix-cli): `npm install -g @adobe/aem-cli`
1. In a terminal, run `aem up` this repo's folder.
1. Start building.

### Authentication
DA requires an Adobe Identity. You will need a _Stage_ Adobe Identity to work on `localhost` or `aem.page`.

#### DA to IMS environment mapping
| Domain | IMS Tier |
| :--- | :--- |
| `localhost` | IMS Stage |
| `aem.page` | IMS Stage |
| `aem.live` | IMS Prod |
| `da.live` | IMS Prod |

### Content
Local development will use DA's stage content repository. If you don't have any content or configs there, make some.

### Admin & Collab
You will want to point your local to stage admin & collab or run these services locally. We recommend using stage.

1. Stage - `localhost:3000/?da-admin=stage&da-collab=stage`
2. Local - `localhost:3000/?da-admin=local&da-collab=local`
3. Reset - `localhost:3000/?da-admin=reset&da-collab=reset`

#### NX

In order to also use the local `nx` scripts, run `npm run local` in the `da-nx` checkout and then enable it via: `localhost:3000/?nx=local`

**Note:** these values will persist in local storage until you reset them.

### Standalone canvas editor

The canvas application uses offline collaboration mode by default: it loads HTML
from the source API and autosaves changes directly after one second of inactivity.
The header reports pending, saving, saved, or failed saves and offers a retry.
Version creation and Prepare actions flush pending changes first. Navigation
waits for pending saves; a failed save keeps the current editor open, and leaving
the page with unsaved changes triggers the browser's warning.

There is no live collaboration or cross-tab synchronization in this mode.
Multiple authors should not edit the same document concurrently. Comments still
load and save through their API, but remote changes are not pushed live.
Set the `ew-editor-doc` element's `offline` property to `false` to opt back into
collab.

### Legacy editor

The legacy `/edit` editor also defaults to local Yjs editing with direct source
autosave. It seeds the editor from the fetched HTML, including DA metadata and
section names, without opening a websocket or synchronizing across tabs. The title
cloud reports save status and displays failed saves with a retry action.
Preview/publish, version creation, and Prepare actions wait for pending saves.
Hash navigation keeps the current editor open if saving fails, and leaving with
pending edits triggers the browser's warning.

`blocks/edit/prose/index.js` accepts `offline: false` to opt into collab, including
an optional `wsPromise`. Its `doc` option is the fetched HTML `Document`; use
`sourcePath` (the `/org/site/path.html` API path) when calling it directly with a
source-bus URL. As with canvas, avoid concurrent editing of the same source file.

### Standalone initialization

`blocks/canvas/ew-editor-doc/prose.js` supports local editing without connecting to
collab or synchronizing across browser tabs:

```js
import initProse from './blocks/canvas/ew-editor-doc/prose.js';
import { getSchema } from 'da-parser';

const schema = getSchema();
const initialDoc = schema.node('doc', null, [
  schema.node('paragraph', null, schema.text('Local content')),
]);
const { proseEl, view, wsProvider, ydoc } = await initProse({
  path: 'https://admin.da.live/source/org/site/page.html',
  permissions: ['read', 'write'],
  offline: true,
  initialDoc,
  setEditable: (editable) => { /* Update the host UI's readiness. */ },
});
document.querySelector('#editor').append(proseEl);
```

`initialDoc` is an optional ProseMirror document node; omitting it starts an empty
editor. It is only accepted with `offline: true`. Editing, awareness, extra plugins,
and local undo/redo remain available. The readiness callback runs before
`initProse()` resolves, without waiting for a server sync, and honors read-only
permissions. Use `initialMetadata` to seed the `daMetadata` map as well.

When calling `initProse()` directly, persistence is the caller's responsibility
(the canvas host supplies it). This option only disables collaboration, not other
network-backed features such as asset uploads. Destroy `view`, `wsProvider`, and
`ydoc` when disposing of the editor. The low-level `initProse()` remains connected
by default; the canvas host explicitly requests offline mode.

### Edge Delivery
If you wish to do any testing that involves Edge Delivery, please note the following:

1. Your local environment will be using Stage Adobe Identity. 
1. Your local/stage project will need to have a stage compatible fstab entry. Hostname: `stage-content.da.live`
1. Edge Delivery cannot validate a Stage Adobe Identity. Your stage project should have auth turned off: `requireAuth: false`

## Additional details
### Version history in Experience Workspace
The Versions panel refreshes automatically after the current page is successfully
previewed or published and its history version is saved. The Refresh icon reloads
history on demand, including versions created by other authors. Both preserve the
current filter and review state and do not replace document content.
Refresh keeps keyboard focus while loading and ignores repeated manual activation.
Automatic version-created notifications still refresh history during an existing request.

The automatic refresh consumes Nexter's `VERSION_EVENT.CREATED` contract from
`nx2/utils/version-events.js`, through the canvas version bridge.

### Recommendations
1. We recommend running `npm install` for linting.

### Dependencies
DA has several libraries / dependencies that are built adhoc.

```shell
# Build Lit
npm run build:da-lit

# Build Prose / YDoc
npm run build:da-y-wrapper
```

Additional details can be [found here](https://github.com/adobe/da-live/wiki/Dependencies).

Canvas library behavior is documented in [docs/canvas-library.md](docs/canvas-library.md).
