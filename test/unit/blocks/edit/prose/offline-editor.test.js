import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import { aem2doc, doc2aem, getSchema, yDocToProsemirror } from 'da-parser';
import { Y, yUndo, yRedo, yUndoPluginKey } from 'da-y-wrapper';
import { setNx } from '../../../../../scripts/utils.js';

setNx('/test/fixtures/nx', { hostname: 'example.com' });
window.location.hash = '#/legacyorg/legacysite/page';
const { default: initProse } = await import('../../../../../blocks/edit/prose/index.js');
await import('../../../../../blocks/edit/da-content/da-content.js');

const SOURCE_HTML = `<body><header></header><main>
  <div data-section-name="Intro"><h2>Title</h2><p>Hello <strong>world</strong></p>
    <div class="cards"><div><div><p>Card content</p></div></div></div>
  </div><div data-section-name="Next"><p>Second section</p></div>
</main><footer></footer>
<div class="da-metadata"><div><div>custom-property</div><div>Preserved</div></div></div>
</body>`;

describe('legacy offline editor', () => {
  let content;
  let title;
  let writes;
  let saveStatus;
  let websocket;
  let fetchStub;

  beforeEach(() => {
    writes = [];
    saveStatus = 200;
    websocket = sinon.stub(window, 'WebSocket').throws(new Error('Unexpected websocket connection'));
    fetchStub = sinon.stub(window, 'fetch').callsFake(async (url, options = {}) => {
      if (options.method === 'POST') {
        const body = options.body instanceof FormData
          ? await options.body.get('data').text() : options.body;
        writes.push({ url: String(url), body });
        return new Response('', { status: saveStatus });
      }
      return new Response('{}', { status: 200 });
    });
    title = document.createElement('div');
    const query = document.querySelector.bind(document);
    sinon.stub(document, 'querySelector').callsFake((selector) => (
      selector === 'da-title' ? title : query(selector)
    ));
    content = document.createElement('da-content');
    content.details = {
      owner: 'legacyorg',
      repo: 'legacysite',
      org: 'legacyorg',
      site: 'legacysite',
      fullpath: '/legacyorg/legacysite/page.html',
      sourceUrl: 'https://admin.da.live/source/legacyorg/legacysite/page.html',
      previewUrl: 'https://main--legacysite--legacyorg.aem.page/page',
    };
    content.permissions = ['read', 'write'];
  });

  afterEach(async () => {
    saveStatus = 200;
    if (content.sourcePersistence) await content.forceSave();
    content.destroyEditor?.();
    content.remove();
    sinon.restore();
  });

  async function initialize(options = {}) {
    await initProse({
      path: content.details.sourceUrl,
      sourcePath: content.details.fullpath,
      doc: new DOMParser().parseFromString(SOURCE_HTML, 'text/html'),
      permissions: content.permissions,
      daContent: content,
      ...options,
    });
    return window.view;
  }

  it('seeds existing content and metadata without a websocket or an initial save', async () => {
    const view = await initialize();
    const { doc } = content.wsProvider;
    expect(content.offline).to.be.true;
    expect(content.wsProvider.shouldConnect).to.be.false;
    expect(content.wsProvider.bcconnected).to.be.false;
    expect(view.state.doc.textContent).to.include('Hello world');
    expect(view.state.doc.textContent).to.include('Card content');
    expect(view.dom.dataset.sectionName).to.equal('Intro');
    expect(doc.getMap('daMetadata').get('custom-property')).to.equal('Preserved');
    expect(doc2aem(doc)).to.include('data-section-name="Next"');
    expect(yUndoPluginKey.getState(view.state).undoManager.canUndo()).to.be.false;
    expect(await content.forceSave()).to.deep.equal({ ok: true });
    expect(writes).to.have.length(0);
    expect(title.saveState.status).to.equal('saved');
    expect(websocket.called).to.be.false;
  });

  it('saves HTML, blocks, section names, and metadata directly through the source API', async () => {
    const view = await initialize();
    view.dispatch(view.state.tr.insertText('Edited ', 1));
    content.wsProvider.doc.getMap('daMetadata').set('custom-property', 'Changed');
    expect(content.hasPendingSave).to.be.true;
    expect(title.saveState.status).to.equal('pending');
    expect(await content.forceSave()).to.deep.equal({ ok: true });
    expect(writes).to.have.length(1);
    expect(writes[0].url).to.equal(content.details.sourceUrl);
    expect(writes[0].body).to.include('Edited Title');
    expect(writes[0].body).to.include('class="cards"');
    expect(writes[0].body).to.include('data-section-name="Intro"');
    expect(writes[0].body).to.include('data-section-name="Next"');
    expect(writes[0].body).to.include('Changed');
    expect(writes[0].body).not.to.include('ProseMirror');
    const roundtrip = new Y.Doc();
    try {
      aem2doc(writes[0].body, roundtrip);
      expect(yDocToProsemirror(getSchema(), roundtrip).toJSON())
        .to.deep.equal(view.state.doc.toJSON());
    } finally {
      roundtrip.destroy();
    }
    expect(content.hasPendingSave).to.be.false;
    expect(websocket.called).to.be.false;
  });

  it('autosaves after the debounce without a collaboration server', async () => {
    const view = await initialize();
    const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    view.dispatch(view.state.tr.insertText('Automatic ', 1));
    await clock.tickAsync(1000);
    await content.forceSave();
    expect(writes).to.have.length(1);
    expect(writes[0].body).to.include('Automatic Title');
    clock.restore();
  });

  it('retains failed saves and reports errors until a successful retry', async () => {
    const log = sinon.stub(console, 'error');
    const view = await initialize();
    view.dispatch(view.state.tr.insertText('Edited ', 1));
    saveStatus = 403;
    expect((await content.forceSave()).ok).to.be.false;
    expect(content.hasPendingSave).to.be.true;
    expect(view.editable).to.be.true;
    expect(title.saveState.status).to.equal('error');
    expect(log.calledOnce).to.be.true;
    saveStatus = 200;
    expect(await content.forceSave()).to.deep.equal({ ok: true });
    expect(title.saveState.status).to.equal('saved');
  });

  it('persists undo and redo without making the initial content undoable', async () => {
    const view = await initialize();
    view.dispatch(view.state.tr.insertText('Edited ', 1));
    await content.forceSave();
    expect(yUndo(view.state)).to.be.true;
    expect(view.state.doc.textContent).not.to.include('Edited Title');
    await content.forceSave();
    expect(writes.at(-1).body).not.to.include('Edited Title');
    expect(yUndoPluginKey.getState(view.state).undoManager.canUndo()).to.be.false;
    expect(yRedo(view.state)).to.be.true;
    await content.forceSave();
    expect(writes.at(-1).body).to.include('Edited Title');
  });

  it('mounts writable documents immediately without waiting for websocket sync', async () => {
    const view = await initialize();
    document.body.append(content);
    await content.updateComplete;
    const editor = content.shadowRoot.querySelector('da-editor');
    await editor.updateComplete;
    expect(editor.offline).to.be.true;
    expect(view.dom.isContentEditable).to.be.true;
    view.focus();
    expect(websocket.called).to.be.false;
  });

  it('mounts read-only documents without creating a writer', async () => {
    content.permissions = ['read'];
    const view = await initialize();
    document.body.append(content);
    await content.updateComplete;
    await content.shadowRoot.querySelector('da-editor').updateComplete;
    expect(view.editable).to.be.false;
    expect(view.dom.isContentEditable).to.be.false;
    expect(content.sourcePersistence).to.be.undefined;
    expect(await content.forceSave()).to.deep.equal({ ok: true });
    expect(writes).to.have.length(0);
  });

  it('warns before unloading unsaved changes and destroys owned resources on removal', async () => {
    const view = await initialize();
    const { doc } = content.wsProvider;
    document.body.append(content);
    await content.updateComplete;
    view.dispatch(view.state.tr.insertText('Final ', 1));
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).to.be.true;
    const persistence = content.sourcePersistence;
    content.remove();
    expect(view.isDestroyed).to.be.true;
    expect(doc.isDestroyed).to.be.true;
    expect(window.view).to.be.undefined;
    expect(await persistence.flush()).to.deep.equal({ ok: true });
    expect(writes.at(-1).body).to.include('Final Title');
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).to.be.false;
  });

  it('uses an explicit canonical source path for the source-bus backend', async () => {
    content.details.fullpath = '/legacybus/legacybus/page.html';
    fetchStub.callsFake(async (url, options = {}) => {
      if (options.method === 'POST') {
        writes.push({ url: String(url), body: options.body });
        return new Response('', { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'x-api-upgrade-available': 'true' } });
    });
    const view = await initialize();
    view.dispatch(view.state.tr.insertText('Bus ', 1));
    expect(await content.forceSave()).to.deep.equal({ ok: true });
    expect(writes[0].url).to.include('/legacybus/sites/legacybus/source/page.html');
    expect(writes[0].body).to.include('Bus Title');
  });

  it('requires explicit connected mode for an injected websocket', async () => {
    try {
      await initialize({ wsPromise: Promise.resolve({}) });
      expect.fail('Expected explicit collaboration opt-in');
    } catch (error) {
      expect(error.message).to.equal('wsPromise requires offline: false.');
    }
    expect(websocket.called).to.be.false;
  });
});
