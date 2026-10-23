import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import { doc2aem, aem2doc, getSchema, yDocToProsemirror } from 'da-parser';
import { Y } from 'da-y-wrapper';
import { setNx } from '../../../../../scripts/utils.js';
import { canvasBus } from '../../../../../blocks/canvas/utils/canvas-bus.js';

setNx('/test/fixtures/nx', { hostname: 'example.com' });

const { loadLocalDocument } = await import('../../../../../blocks/canvas/ew-editor-doc/utils/local-document.js');
await import('../../../../../blocks/canvas/ew-editor-doc/ew-editor-doc.js');
await import('../../../../../blocks/canvas/ew-selection-toolbar/ew-selection-toolbar.js');

const SOURCE_HTML = `<body><header></header><main>
  <div data-section-name="Intro"><h2>Title</h2><p>Hello <strong>world</strong></p>
    <div class="cards"><div><div><p>Card content</p></div></div></div>
  </div><div data-section-name="Next"><p>Second section</p></div>
</main><footer></footer>
<div class="da-metadata"><div><div>custom-property</div><div>Preserved</div></div></div>
</body>`;

describe('canvas offline source editor', () => {
  let el;
  let fetchStub;
  let websocket;
  let writes;
  let sourceStatus;
  let saveStatus;

  beforeEach(() => {
    writes = [];
    sourceStatus = 200;
    saveStatus = 200;
    websocket = sinon.stub(window, 'WebSocket').callsFake(function FakeWebSocket() {
      this.readyState = 0;
      this.close = () => {};
      this.send = () => {};
    });
    sinon.stub(customElements.get('ew-selection-toolbar').prototype, '_checkAemAssets').resolves();
    fetchStub = sinon.stub(window, 'fetch').callsFake(async (url, opts = {}) => {
      if (opts.method === 'POST') {
        const body = opts.body instanceof FormData
          ? await opts.body.get('data').text()
          : opts.body;
        writes.push({ url: String(url), body });
        return new Response('', { status: saveStatus });
      }
      if (String(url).includes('/ping/')) return new Response('', { status: 200 });
      return new Response(SOURCE_HTML, { status: sourceStatus });
    });
    el = document.createElement('ew-editor-doc');
    el.ctx = { org: 'localorg', repo: 'localsite', path: 'localorg/localsite/page' };
    el.session = {
      ok: true,
      sourceUrl: 'https://admin.da.live/source/localorg/localsite/page.html',
      permissions: ['read', 'write'],
      token: 'test-token',
      docId: null,
    };
  });

  afterEach(async () => {
    if (el._sourcePersistence) await el.forceSave();
    el.remove();
    el._teardown();
    document.querySelectorAll('.nx-toast').forEach((toast) => toast.remove());
    sinon.restore();
  });

  it('loads the existing document and metadata locally by default without writing on load', async () => {
    expect(el.offline).to.be.true;
    await el._loadEditor();
    const { view, ydoc, wsProvider } = el._proseContext;
    expect(websocket.called).to.be.false;
    expect(wsProvider.shouldConnect).to.be.false;
    expect(view.state.doc.textContent).to.include('Hello world');
    expect(view.state.doc.textContent).to.include('Card content');
    expect(ydoc.getMap('daMetadata').get('custom-property')).to.equal('Preserved');
    expect(view.dom.dataset.sectionName).to.equal('Intro');
    expect(doc2aem(ydoc)).to.include('data-section-name="Next"');
    expect(await el.forceSave()).to.deep.equal({ ok: true });
    expect(writes).to.have.length(0);
  });

  it('saves edited HTML and metadata to the source API and preserves blocks and sections', async () => {
    await el._loadEditor();
    const { view, ydoc } = el._proseContext;
    view.dispatch(view.state.tr.insertText('Edited ', 1));
    ydoc.getMap('daMetadata').set('custom-property', 'Changed');
    expect(el.hasPendingSave).to.be.true;
    expect(await el.forceSave()).to.deep.equal({ ok: true });
    expect(writes).to.have.length(1);
    expect(writes[0].url).to.equal(el.session.sourceUrl);
    expect(writes[0].body).to.include('Edited Title');
    expect(writes[0].body).to.include('class="cards"');
    expect(writes[0].body).to.include('data-section-name="Intro"');
    expect(writes[0].body).to.include('data-section-name="Next"');
    expect(writes[0].body).to.include('Changed');
    expect(writes[0].body).not.to.include('ProseMirror');
    const savedDoc = new Y.Doc();
    try {
      aem2doc(writes[0].body, savedDoc);
      const roundtrip = yDocToProsemirror(getSchema(), savedDoc);
      expect(roundtrip.toJSON()).to.deep.equal(view.state.doc.toJSON());
    } finally {
      savedDoc.destroy();
    }
    expect(el.hasPendingSave).to.be.false;
    expect(websocket.called).to.be.false;
  });

  it('reports failed saves while retaining the editable document and supports retry', async () => {
    const showError = sinon.stub(el, '_showSaveError').resolves();
    const states = [];
    const unsubscribe = canvasBus.editorSaveState.subscribe((state) => states.push(state));
    try {
      await el._loadEditor();
      el._proseContext.view.dispatch(el._proseContext.view.state.tr.insertText('Edited ', 1));
      saveStatus = 403;
      expect((await el.forceSave()).ok).to.be.false;
      expect(el.hasPendingSave).to.be.true;
      expect(el._proseContext.view.editable).to.be.true;
      expect(states.at(-1).status).to.equal('error');
      expect(showError.calledOnce).to.be.true;
      saveStatus = 200;
      expect(await el.forceSave()).to.deep.equal({ ok: true });
      expect(states.at(-1).status).to.equal('saved');
    } finally {
      unsubscribe();
    }
  });

  it('saves the offline source before comparison and propagates save failures', async () => {
    sinon.stub(el, '_showSaveError').resolves();
    await el._loadEditor();
    const context = { org: 'localorg', site: 'localsite', path: 'page' };
    el._proseContext.view.dispatch(el._proseContext.view.state.tr.insertText('Compare ', 1));
    saveStatus = 403;
    expect((await el.saveForComparison(context)).ok).to.be.false;
    expect(el.hasPendingSave).to.be.true;
    saveStatus = 200;
    expect(await el.saveForComparison(context)).to.deep.equal({ ok: true });
    expect(writes.at(-1).body).to.include('Compare Title');
    expect(el.hasPendingSave).to.be.false;
    expect(websocket.called).to.be.false;
  });

  it('loads read-only documents without creating a source writer', async () => {
    el.session.permissions = ['read'];
    await el._loadEditor();
    expect(el._proseContext.view.editable).to.be.false;
    expect(el._sourcePersistence).to.be.undefined;
    expect(await el.forceSave()).to.deep.equal({ ok: true });
    expect(writes).to.have.length(0);
  });

  it('still supports explicit collab opt-in without loading source content locally', async () => {
    el.offline = false;
    await el._loadEditor();
    expect(el._proseContext.wsProvider.shouldConnect).to.be.true;
    expect(websocket.calledOnce).to.be.true;
    expect(el._sourcePersistence).to.be.undefined;
    expect(fetchStub.called).to.be.false;
  });

  it('initializes a missing document and persists it when write access is available', async () => {
    sourceStatus = 404;
    await el._loadEditor();
    expect(el._proseContext.view).to.exist;
    expect(el.hasPendingSave).to.be.true;
    expect(await el.forceSave()).to.deep.equal({ ok: true });
    expect(writes).to.have.length(1);
    expect(writes[0].body).to.include('<main>');
  });

  it('surfaces load failures instead of opening an empty editor', async () => {
    sourceStatus = 403;
    await el._loadEditor();
    expect(el._proseContext).to.be.undefined;
    expect(el._error).to.equal('Not permitted');
    expect(websocket.called).to.be.false;
    expect(writes).to.have.length(0);
  });

  it('ignores a source read that completes after teardown', async () => {
    let finishRead;
    let signalStarted;
    const started = new Promise((resolve) => { signalStarted = resolve; });
    fetchStub.callsFake(() => new Promise((resolve) => {
      finishRead = resolve;
      signalStarted();
    }));
    const loading = el._loadEditor();
    await started;
    el._teardown();
    finishRead(new Response(SOURCE_HTML, { status: 200 }));
    await loading;
    expect(el._proseContext).to.be.undefined;
    expect(websocket.called).to.be.false;
  });

  it('flushes pending snapshots before destroying the document', async () => {
    await el._loadEditor();
    const { view, ydoc, wsProvider } = el._proseContext;
    view.dispatch(view.state.tr.insertText('Final ', 1));
    const persistence = el._sourcePersistence;
    el._teardown();
    expect(await persistence.flush()).to.deep.equal({ ok: true });
    expect(writes[0].body).to.include('Final Title');
    expect(ydoc.isDestroyed).to.be.true;
    expect(wsProvider.shouldConnect).to.be.false;
  });

  it('does not treat a network error as a missing document', async () => {
    fetchStub.rejects(new Error('Source unavailable'));
    try {
      await loadLocalDocument(el.session.sourceUrl);
      expect.fail('Expected the source read to fail');
    } catch (error) {
      expect(error.message).to.equal('Source unavailable');
    }
    expect(writes).to.have.length(0);
  });

  it('mounts offline, handles save requests, and warns before leaving with pending edits', async () => {
    const load = el._loadEditor.bind(el);
    let signalReady;
    const ready = new Promise((resolve) => { signalReady = resolve; });
    sinon.stub(el, '_loadEditor').callsFake(async () => {
      await load();
      signalReady();
    });
    document.body.append(el);
    await ready;
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('.ProseMirror')).to.exist;
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).to.be.false;

    const { view } = el._proseContext;
    view.dispatch(view.state.tr.insertText('Pending ', 1));
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).to.be.true;
    canvasBus.editorSaveRequest.emit();
    await el.forceSave();
    expect(writes[0].body).to.include('Pending Title');
    expect(websocket.called).to.be.false;
  });
});
