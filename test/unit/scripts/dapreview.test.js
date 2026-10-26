import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import daPreview from '../../../scripts/dapreview.js';

describe('DA preview handshake', () => {
  let stylesheet;
  let addEventListener;
  let channel;

  beforeEach(async () => {
    stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('/styles/dapreview.css', window.location.origin).href;
    document.head.append(stylesheet);
    addEventListener = sinon.spy(window, 'addEventListener');
    channel = new MessageChannel();
    await daPreview(async () => {});
  });

  afterEach(() => {
    addEventListener.getCalls()
      .filter(({ args }) => args[0] === 'message')
      .forEach(({ args }) => window.removeEventListener(...args));
    stylesheet.remove();
    channel.port1.close();
    channel.port2.close();
    sinon.restore();
  });

  [
    'https://da.az-boxa.aem.live',
    'https://main--helix-azure-da-live--adobe.az-boxa.aem.live',
    'https://preview--helix-azure-da-live--adobe.az-boxa.aem.live',
    'https://da.live',
    'https://main--da-live--adobe.aem.live',
    'https://main--da-live--adobe.aem.page',
    'http://localhost:3000',
    'https://localhost',
  ].forEach((origin) => {
    it(`acknowledges the editor at ${origin}`, () => {
      const port = channel.port1;
      sinon.spy(port, 'postMessage');
      window.dispatchEvent(new MessageEvent('message', { origin, data: { ready: true }, ports: [port] }));

      expect(port.postMessage.calledOnceWithExactly({ ready: true })).to.be.true;
      expect(port.onmessage).to.be.a('function');
    });
  });

  [
    'https://da.az-boxa.aem.live.attacker.example',
    'https://main--helix-azure-da-live--other.az-boxa.aem.live',
    'https://main--other--adobe.az-boxa.aem.live',
    'https://main--helix-azure-da-live--adobe.az-boxa.aem.live.attacker.example',
  ].forEach((origin) => {
    it(`rejects an unrelated origin: ${origin}`, () => {
      const warn = sinon.stub(console, 'warn');
      const port = channel.port1;
      sinon.spy(port, 'postMessage');
      window.dispatchEvent(new MessageEvent('message', { origin, data: { ready: true }, ports: [port] }));

      expect(port.postMessage.called).to.be.false;
      expect(warn.calledOnceWithExactly('DA Preview: Origin not allowed', origin)).to.be.true;
    });
  });
});
