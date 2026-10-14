import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import { setNx } from '../../../../../scripts/utils.js';

setNx('/test/fixtures/nx', { hostname: 'example.com' });

const { createCommentsStoreFor, createEditorComments } = await import('../../../../../blocks/canvas/ew-editor-doc/utils/editor-comments.js');
const { setCommentsController } = await import('../../../../../blocks/canvas/editor-utils/comments-bridge.js');

describe('ew-editor-doc comments wiring', () => {
  afterEach(() => {
    setCommentsController(null);
    sinon.restore();
  });

  it('createCommentsStoreFor returns null when docId is missing', () => {
    const ctx = { org: 'o', repo: 's', path: 'o/s/p' };
    expect(createCommentsStoreFor({ docId: null }, ctx)).to.equal(null);
  });

  it('createCommentsStoreFor returns a store when docId present', () => {
    const ctx = { org: 'o', repo: 's', path: 'o/s/p' };
    const store = createCommentsStoreFor({ docId: 'doc-1' }, ctx);
    expect(store).to.be.an('object');
    expect(store.size).to.equal(0);
  });

  it('loads comments immediately offline without waiting for a synced event', async () => {
    const fetch = sinon.stub(window, 'fetch').resolves(new Response('[]', { status: 200 }));
    const comments = createEditorComments({
      getView: () => null,
      getPort: () => null,
      getContainer: () => null,
    });
    const wsProvider = { synced: false, on: sinon.spy() };
    comments.createPlugin({ docId: 'doc-1' }, { org: 'o', repo: 's' }, wsProvider);
    try {
      await comments.loadStore(wsProvider, { offline: true });
      expect(fetch.calledOnce).to.be.true;
      expect(wsProvider.on.called).to.be.false;
      expect(comments.controller.loaded).to.be.true;
    } finally {
      comments.teardown();
    }
  });
});
