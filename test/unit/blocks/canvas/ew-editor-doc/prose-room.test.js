import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import { yUndo, yRedo, yXmlFragmentToProsemirrorJSON } from 'da-y-wrapper';
import { getSchema } from 'da-parser';
import { setNx } from '../../../../../scripts/utils.js';
import { canvasBus } from '../../../../../blocks/canvas/utils/canvas-bus.js';

setNx('/test/fixtures/nx', { hostname: 'example.com' });

let initProse;

before(async () => {
  ({ default: initProse } = await import('../../../../../blocks/canvas/ew-editor-doc/prose.js'));
});

async function connect(sourceUrl) {
  const result = await initProse({
    path: sourceUrl,
    permissions: ['read', 'write'],
    setEditable: () => {},
    getToken: () => 'test-token',
  });
  return result;
}

function teardown({ wsProvider, ydoc, view }) {
  view?.destroy?.();
  wsProvider.disconnect({ data: 'Client navigation' });
  wsProvider.destroy?.();
  ydoc.destroy();
}

let websocket;
beforeEach(() => {
  websocket = sinon.stub(window, 'WebSocket').callsFake(function FakeWebSocket() {
    this.readyState = 0;
    this.close = () => {};
    this.send = () => {};
  });
});
afterEach(() => sinon.restore());

describe('canvas collab room', () => {
  it('keeps a legacy document in its da-admin room', async () => {
    const result = await connect('https://admin.da.live/source/roomorg/roomsite/page.html');
    try {
      expect(result.wsProvider.roomname).to.equal('https://admin.da.live/source/roomorg/roomsite/page.html');
      expect(websocket.calledOnce).to.be.true;
      expect(result.wsProvider.shouldConnect).to.be.true;
    } finally {
      teardown(result);
    }
  });

  it('puts a source-bus document in its api.aem.live room', async () => {
    // da-collab reads the store off the room name, so the room must name the document's real store
    const result = await connect('https://api.aem.live/roomorg/sites/roomsite/source/page.html');
    try {
      expect(result.wsProvider.roomname).to.equal('https://api.aem.live/roomorg/sites/roomsite/source/page.html');
    } finally {
      teardown(result);
    }
  });

  it('still waits for sync before notifying the host that editing is ready', async () => {
    const setEditable = sinon.spy();
    const result = await initProse({
      path: 'https://admin.da.live/source/roomorg/roomsite/page.html',
      permissions: ['read', 'write'],
      setEditable,
    });
    try {
      expect(setEditable.called).to.be.false;
      result.wsProvider.emit('synced', [false]);
      expect(setEditable.called).to.be.false;
      result.wsProvider.emit('synced', [true]);
      expect(setEditable.calledOnceWithExactly(true)).to.be.true;
    } finally {
      teardown(result);
    }
  });
});

describe('canvas offline prose', () => {
  const path = 'https://admin.da.live/source/roomorg/roomsite/local.html';
  let editors;

  beforeEach(() => { editors = []; });
  afterEach(() => editors.forEach(teardown));

  async function createEditor(options = {}) {
    const result = await initProse({
      path,
      permissions: ['read', 'write'],
      offline: true,
      ...options,
    });
    editors.push(result);
    return result;
  }

  function documentWithText(text) {
    const schema = getSchema();
    return schema.node('doc', null, [
      schema.node('paragraph', null, schema.text(text)),
    ]);
  }

  it('starts editable without a websocket, token, or sync event', async () => {
    const setEditable = sinon.spy();
    const getToken = sinon.spy();
    const result = await createEditor({ setEditable, getToken });

    expect(websocket.called).to.be.false;
    expect(getToken.called).to.be.false;
    expect(result.wsProvider.shouldConnect).to.be.false;
    expect(result.wsProvider.disableBc).to.be.true;
    expect(result.wsProvider.bcconnected).to.be.false;
    expect(result.wsProvider.synced).to.be.false;
    expect(result.view.editable).to.be.true;
    expect(result.view.state.doc.textContent).to.equal('');
    expect(setEditable.calledOnceWithExactly(true)).to.be.true;
    expect(result.wsProvider.awareness.getLocalState().user.name).to.equal('Anonymous');
  });

  it('loads initial content into both ProseMirror and Yjs', async () => {
    const schema = getSchema();
    const initialDoc = schema.node('doc', null, [
      schema.node('heading', { level: 2 }, schema.text('Heading')),
      schema.node('paragraph', null, schema.text('Bold text', [schema.mark('strong')])),
    ]);
    const { view, ydoc } = await createEditor({ initialDoc });

    expect(view.state.doc.toJSON()).to.deep.equal(initialDoc.toJSON());
    const yJson = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment('prosemirror'));
    expect(schema.nodeFromJSON(yJson).toJSON()).to.deep.equal(initialDoc.toJSON());
  });

  it('supports local edits and undo/redo without undoing initial content', async () => {
    const { view, ydoc, undoManager } = await createEditor({ initialDoc: documentWithText('Initial') });

    expect(undoManager).to.exist;
    expect(undoManager.canUndo()).to.be.false;
    view.dispatch(view.state.tr.insertText(' edited', 8));
    expect(view.state.doc.textContent).to.equal('Initial edited');
    expect(ydoc.getXmlFragment('prosemirror').toString()).to.include('Initial edited');
    expect(yUndo(view.state)).to.be.true;
    expect(view.state.doc.textContent).to.equal('Initial');
    expect(undoManager.canUndo()).to.be.false;
    expect(yRedo(view.state)).to.be.true;
    expect(view.state.doc.textContent).to.equal('Initial edited');
    expect(websocket.called).to.be.false;
  });

  it('honors read-only permissions and reports readiness without syncing', async () => {
    const setEditable = sinon.spy();
    const { view } = await createEditor({
      permissions: ['read'],
      initialDoc: documentWithText('Read only'),
      setEditable,
    });

    expect(view.editable).to.be.false;
    expect(view.state.doc.textContent).to.equal('Read only');
    expect(setEditable.calledOnceWithExactly(false)).to.be.true;
  });

  it('passes the disconnected provider and seeded document to extra plugins', async () => {
    const extraPlugins = sinon.spy(({ wsProvider, ydoc }) => {
      expect(wsProvider.shouldConnect).to.be.false;
      expect(ydoc.getXmlFragment('prosemirror').toString()).to.include('Initial');
      return [];
    });
    await createEditor({ initialDoc: documentWithText('Initial'), extraPlugins });
    expect(extraPlugins.calledOnce).to.be.true;
  });

  it('isolates editors sharing the same room', async () => {
    const first = await createEditor({ initialDoc: documentWithText('First') });
    const second = await createEditor({ initialDoc: documentWithText('Second') });
    first.view.dispatch(first.view.state.tr.insertText(' edited', 6));

    expect(first.view.state.doc.textContent).to.equal('First edited');
    expect(second.view.state.doc.textContent).to.equal('Second');
    expect(first.wsProvider.bcconnected).to.be.false;
    expect(second.wsProvider.bcconnected).to.be.false;
  });

  it('keeps the version shortcut available for direct-source persistence', async () => {
    const { view } = await createEditor();
    const requestVersion = sinon.spy();
    const unsubscribe = canvasBus.newVersionRequest.subscribe(requestVersion);
    try {
      const isMac = /Mac/.test(navigator.platform);
      const event = new KeyboardEvent('keydown', { key: 's', altKey: true, metaKey: isMac, ctrlKey: !isMac });
      view.someProp('handleKeyDown', (handler) => handler(view, event));
      expect(requestVersion.calledOnce).to.be.true;
    } finally {
      unsubscribe();
    }
  });

  it('seeds DA metadata without adding initialization to undo history', async () => {
    const initialMetadata = { 'first-section-name': 'Intro', 'custom-property': 'Preserved' };
    const { ydoc, undoManager } = await createEditor({
      initialDoc: documentWithText('Initial'),
      initialMetadata,
    });
    expect(Object.fromEntries(ydoc.getMap('daMetadata').entries())).to.deep.equal(initialMetadata);
    expect(undoManager.canUndo()).to.be.false;
  });

  it('rejects initial content in connected mode before opening a websocket', async () => {
    try {
      await createEditor({ offline: false, initialDoc: documentWithText('Initial') });
      expect.fail('Expected initialDoc to require offline mode');
    } catch (error) {
      expect(error.message).to.include('initialDoc requires offline mode');
    }
    expect(websocket.called).to.be.false;
  });

  it('rejects non-document nodes before allocating a provider', async () => {
    try {
      await createEditor({ initialDoc: getSchema().node('paragraph') });
      expect.fail('Expected initialDoc to be a document node');
    } catch (error) {
      expect(error.message).to.equal('initialDoc must be a ProseMirror document node.');
    }
    expect(websocket.called).to.be.false;
  });
});
