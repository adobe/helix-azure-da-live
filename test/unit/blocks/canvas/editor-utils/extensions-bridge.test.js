import { expect } from '@esm-bundle/chai';
import { EditorState, EditorView, TextSelection } from 'da-y-wrapper';
import { getSchema } from 'da-parser';
import { setNx } from '../../../../../scripts/utils.js';
import { canvasBus } from '../../../../../blocks/canvas/utils/canvas-bus.js';
import {
  createExtensionsBridgePlugin,
  getExtensionsBridge,
} from '../../../../../blocks/canvas/editor-utils/extensions-bridge.js';

setNx('/test/fixtures/nx', { hostname: 'example.com' });

function makeBridgedView(json, options) {
  const schema = getSchema();
  const doc = schema.nodeFromJSON(json);
  const dom = document.createElement('div');
  document.body.appendChild(dom);
  const plugins = [createExtensionsBridgePlugin(options)];
  const state = EditorState.create({ schema, doc, plugins });
  const view = new EditorView(dom, {
    state,
    dispatchTransaction(tr) { view.updateState(view.state.apply(tr)); },
  });
  return view;
}

describe('createExtensionsBridgePlugin', () => {
  afterEach(() => {
    getExtensionsBridge().view = null;
  });

  it('emits canvasBus.editorDocState whenever a transaction changes the doc', () => {
    const view = makeBridgedView({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] });
    let calls = 0;
    const unsub = canvasBus.editorDocState.subscribe(() => { calls += 1; });

    view.dispatch(view.state.tr.insertText('!', 3));

    unsub();
    expect(calls).to.equal(1);
  });

  it('does not emit for a selection-only transaction', () => {
    const view = makeBridgedView({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] });
    let calls = 0;
    const unsub = canvasBus.editorDocState.subscribe(() => { calls += 1; });

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));

    unsub();
    expect(calls).to.equal(0);
  });

  it('preserves the offline save callback across edits and clears it on teardown', () => {
    const forceSave = () => Promise.resolve({ ok: true });
    const view = makeBridgedView({ type: 'doc', content: [{ type: 'paragraph' }] }, { forceSave });
    try {
      view.dispatch(view.state.tr.insertText('Saved locally', 1));
      expect(getExtensionsBridge().forceSave).to.equal(forceSave);
    } finally {
      view.destroy();
      view.dom.remove();
    }
    expect(getExtensionsBridge().forceSave).to.be.null;
  });

  it('does not clear a newer editor or its save callback when an older editor is destroyed', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
    const oldView = makeBridgedView(doc);
    const forceSave = () => Promise.resolve({ ok: true });
    const newView = makeBridgedView(doc, { forceSave });
    try {
      oldView.destroy();
      expect(getExtensionsBridge().view).to.equal(newView);
      expect(getExtensionsBridge().forceSave).to.equal(forceSave);
    } finally {
      oldView.dom.remove();
      newView.destroy();
      newView.dom.remove();
    }
  });
});
