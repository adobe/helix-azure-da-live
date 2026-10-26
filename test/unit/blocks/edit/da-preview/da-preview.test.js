import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import DaPreview from '../../../../../blocks/edit/da-preview/da-preview.js';

describe('DA preview connection', () => {
  let clock;
  let warn;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    warn = sinon.stub(console, 'warn');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('reports a handshake timeout with the preview URL and editor origin', () => {
    const preview = { handleFirstLoad: sinon.spy() };
    const target = { src: 'https://main--site--org.da-preview.az-boxa.aem.live/page?dapreview=on' };
    DaPreview.prototype.iframeLoaded.call(preview, { target });
    clock.tick(3500);

    expect(preview.handleFirstLoad.callCount).to.equal(6);
    expect(preview._message.text).to.equal('Could not load live preview');
    expect(warn.calledOnce).to.be.true;
    expect(warn.firstCall.args[0]).to.include('No handshake response');
    expect(warn.firstCall.args[1]).to.deep.equal({
      previewUrl: target.src,
      editorOrigin: window.location.origin,
    });
  });

  it('stops retrying without a warning once the handshake succeeds', () => {
    const preview = { handleFirstLoad: sinon.spy() };
    DaPreview.prototype.iframeLoaded.call(preview, { target: { src: 'https://preview.example/page' } });
    clock.tick(500);
    preview.initialized = true;
    clock.tick(3500);

    expect(preview.handleFirstLoad.calledOnce).to.be.true;
    expect(preview._message).to.equal(null);
    expect(warn.called).to.be.false;
  });
});
