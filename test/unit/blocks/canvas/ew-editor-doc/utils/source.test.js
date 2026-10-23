import { expect } from '@esm-bundle/chai';
import { setNx } from '../../../../../../scripts/utils.js';

setNx('/test/fixtures/nx', { hostname: 'example.com' });

let buildSourceUrl;
let checkDoc;
let fetchDoc;
let saveDoc;

// isHlx6 memoizes its answer per site, so each case needs its own org/site
function stubPing({ upgraded }) {
  const saved = window.fetch;
  const calls = [];
  window.fetch = async (url, opts) => {
    calls.push({ url: typeof url === 'string' ? url : url.url, opts });
    const headers = upgraded ? { 'x-api-upgrade-available': 'true' } : {};
    return new Response('', { status: 200, headers });
  };
  return { calls, restore: () => { window.fetch = saved; } };
}

before(async () => {
  ({ buildSourceUrl, checkDoc, fetchDoc, saveDoc } = await import('../../../../../../blocks/canvas/ew-editor-doc/utils/source.js'));
});

describe('canvas source content', () => {
  it('reads source content without caching', async () => {
    const { calls, restore } = stubPing({ upgraded: false });
    try {
      await fetchDoc('https://admin.da.live/source/readorg/readsite/page.html');
      expect(calls[0].opts.cache).to.equal('no-store');
      expect(calls[0].opts.method).to.be.undefined;
    } finally {
      restore();
    }
  });

  it('saves legacy HTML using the source API multipart format', async () => {
    const { calls, restore } = stubPing({ upgraded: false });
    try {
      await saveDoc('saveorg/savesite/dir/page', '<body>Legacy</body>');
      const write = calls.find((call) => call.opts?.method === 'POST');
      expect(write.url).to.equal('https://admin.da.live/source/saveorg/savesite/dir/page.html');
      expect(write.opts.body).to.be.instanceOf(FormData);
      expect(await write.opts.body.get('data').text()).to.equal('<body>Legacy</body>');
    } finally {
      restore();
    }
  });

  it('saves source-bus HTML as a raw HTML body', async () => {
    const { calls, restore } = stubPing({ upgraded: true });
    try {
      await saveDoc('/savebus/savebus/dir/page', '<body>Source bus</body>');
      const write = calls.find((call) => call.opts?.method === 'POST');
      expect(write.url).to.equal('https://api.aem.live/savebus/sites/savebus/source/dir/page.html');
      expect(write.opts.body).to.equal('<body>Source bus</body>');
      expect(write.opts.headers['Content-Type']).to.equal('text/html');
    } finally {
      restore();
    }
  });
});

afterEach(() => {
  window.localStorage.removeItem('hlx6-upgrade');
});

describe('canvas buildSourceUrl', () => {
  it('keeps a legacy site on da-admin', async () => {
    const { restore } = stubPing({ upgraded: false });
    try {
      const url = await buildSourceUrl('/legacyorg/legacysite/dir/page');
      expect(url).to.equal('https://admin.da.live/source/legacyorg/legacysite/dir/page.html');
    } finally {
      restore();
    }
  });

  it('sends a source-bus site to api.aem.live', async () => {
    const { restore } = stubPing({ upgraded: true });
    try {
      const url = await buildSourceUrl('/hlxorg/hlxsite/dir/page');
      expect(url).to.equal('https://api.aem.live/hlxorg/sites/hlxsite/source/dir/page.html');
    } finally {
      restore();
    }
  });

  it('routes a document at the site root', async () => {
    const { restore } = stubPing({ upgraded: true });
    try {
      const url = await buildSourceUrl('/rootorg/rootsite/index');
      expect(url).to.equal('https://api.aem.live/rootorg/sites/rootsite/source/index.html');
    } finally {
      restore();
    }
  });

  it('answers null for a path it cannot use', async () => {
    expect(await buildSourceUrl('')).to.equal(null);
    expect(await buildSourceUrl('   ')).to.equal(null);
    expect(await buildSourceUrl(null)).to.equal(null);
    expect(await buildSourceUrl(42)).to.equal(null);
  });
});

describe('canvas checkDoc', () => {
  // the source bus is not on da-live's token allowlist, so that read goes through nx2
  it('asks api.aem.live for a source-bus document, with a bearer', async () => {
    const { calls, restore } = stubPing({ upgraded: true });
    try {
      const url = await buildSourceUrl('/checkorg/checksite/page');
      await checkDoc(url);
      const head = calls.find((c) => c.opts?.method === 'HEAD');
      expect(head, 'no HEAD was issued').to.exist;
      expect(head.url).to.equal('https://api.aem.live/checkorg/sites/checksite/source/page.html');
      expect(head.opts.headers.Authorization).to.equal('Bearer test-token');
    } finally {
      restore();
    }
  });

  it('does not send Azure credentials to the upstream legacy document store', async () => {
    window.localStorage.setItem('nx-ims', 'true');
    window.adobeIMS = { getAccessToken: () => ({ token: 'live-token' }) };
    const { calls, restore } = stubPing({ upgraded: false });
    try {
      const url = await buildSourceUrl('/checkleg/checkleg/page');
      await checkDoc(url);
      const head = calls.find((c) => c.opts?.method === 'HEAD');
      expect(head, 'no HEAD was issued').to.exist;
      expect(head.url).to.equal('https://admin.da.live/source/checkleg/checkleg/page.html');
      expect(new Headers(head.opts.headers).has('Authorization')).to.be.false;
    } finally {
      restore();
      window.localStorage.removeItem('nx-ims');
      delete window.adobeIMS;
    }
  });

  it('reads the action list da-admin sends', async () => {
    const saved = window.fetch;
    window.fetch = async (url) => {
      if (String(url).includes('/ping/')) return new Response('', { status: 200 });
      return new Response('', {
        status: 200,
        headers: { 'x-da-actions': '/site/page.html=read' },
      });
    };
    try {
      const resp = await checkDoc('https://admin.da.live/source/permorg/permsite/page.html');
      expect(resp.permissions).to.deep.equal(['read']);
    } finally {
      window.fetch = saved;
    }
  });

  it('assumes read and write when the store sends no action list', async () => {
    const { restore } = stubPing({ upgraded: true });
    try {
      const url = await buildSourceUrl('/faketorg/fakesite/page');
      const resp = await checkDoc(url);
      expect(resp.permissions).to.deep.equal(['read', 'write']);
    } finally {
      restore();
    }
  });
});
