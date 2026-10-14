import { expect } from '@esm-bundle/chai';
import sinon from 'sinon';
import { setNx } from '../../../../../scripts/utils.js';

setNx('/test/fixtures/nx', { hostname: 'example.com' });
await import('../../../../../blocks/edit/da-versions/da-versions.js');

describe('legacy version source persistence', () => {
  let el;
  let fetchStub;

  beforeEach(async () => {
    fetchStub = sinon.stub(window, 'fetch').resolves(new Response('', { status: 201 }));
    el = document.createElement('da-versions');
    el.path = '/versionorg/versionsite/page.html';
    el._versions = [];
    el._newVersion = { date: 'Today', time: 'Now', users: [], isVersion: true };
    sinon.stub(el, 'getVersions').resolves();
    document.body.append(el);
    await el.updateComplete;
  });

  afterEach(() => {
    el.remove();
    sinon.restore();
  });

  function submit() {
    return el.handleNewSubmit({
      preventDefault() {},
      target: { elements: { label: { value: 'Saved snapshot' } } },
    });
  }

  it('waits for source saving and prevents duplicate version creation', async () => {
    let finishSave;
    el.forceSave = sinon.stub().returns(new Promise((resolve) => { finishSave = resolve; }));
    const saving = submit();
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('form button').disabled).to.be.true;
    expect(fetchStub.called).to.be.false;
    await submit();
    expect(el.forceSave.calledOnce).to.be.true;
    finishSave({ ok: true });
    await saving;
    const posts = fetchStub.getCalls().filter((call) => call.args[1]?.method === 'POST');
    expect(posts).to.have.length(1);
    expect(posts[0].args[0]).to.equal('https://admin.da.live/versionsource/versionorg/versionsite/page.html');
    expect(el._newVersion).to.be.null;
    expect(el._savingVersion).to.be.false;
  });

  it('retains the version form and displays a failed source save', async () => {
    el.forceSave = sinon.stub().resolves({ ok: false, error: 'Source unavailable' });
    await submit();
    await el.updateComplete;
    expect(fetchStub.called).to.be.false;
    expect(el._newVersion).to.exist;
    expect(el.shadowRoot.querySelector('[role="alert"]').textContent)
      .to.include('Source unavailable');
    expect(el.shadowRoot.querySelector('form button').disabled).to.be.false;
  });

  it('preserves version creation for consumers without a source-save callback', async () => {
    await submit();
    expect(fetchStub.getCalls().some((call) => call.args[1]?.method === 'POST')).to.be.true;
    expect(el._newVersion).to.be.null;
  });

  it('retains the form and reports a failed version request', async () => {
    fetchStub.resolves(new Response('', { status: 500 }));
    el.forceSave = sinon.stub().resolves({ ok: true });
    await submit();
    expect(el._newVersion).to.exist;
    expect(el._saveError).to.equal('Could not save version. Please try again.');
  });
});
