import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const config = { accessToken: 't', expiresAt: 'x', apiKey: 'k', appId: '1' };

type Lib = typeof import('../lib/googlePicker');
let lib: Lib;

beforeEach(async () => {
  vi.resetModules();
  lib = await import('../lib/googlePicker');
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.google;
  delete window.gapi;
});

const captureScripts = () => {
  const scripts: HTMLScriptElement[] = [];
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    scripts.push(node as unknown as HTMLScriptElement);
    return node;
  });
  return scripts;
};

describe('googlePicker lib', () => {
  it('loadPickerApi resolves immediately when google.picker is already present', async () => {
    window.google = { picker: {} as never };
    await expect(lib.loadPickerApi()).resolves.toBeUndefined();
  });

  it('two loadPickerApi calls append exactly one script and share the promise', async () => {
    const scripts = captureScripts();
    const a = lib.loadPickerApi();
    const b = lib.loadPickerApi();
    expect(scripts).toHaveLength(1);
    expect(a).toBe(b);
    window.gapi = { load: (_n, o) => o.callback() };
    scripts[0].onload?.(new Event('load'));
    await expect(a).resolves.toBeUndefined();
  });

  it('retries with a new script after onerror', async () => {
    const scripts = captureScripts();
    const first = lib.loadPickerApi();
    scripts[0].onerror?.(new Event('error'));
    await expect(first).rejects.toThrow();
    const second = lib.loadPickerApi();
    expect(scripts).toHaveLength(2);
    window.gapi = { load: (_n, o) => o.callback() };
    scripts[1].onload?.(new Event('load'));
    await expect(second).resolves.toBeUndefined();
  });

  it('rejects when gapi is missing after the script loads', async () => {
    const scripts = captureScripts();
    const p = lib.loadPickerApi();
    scripts[0].onload?.(new Event('load'));
    await expect(p).rejects.toThrow();
  });

  it('openPicker rejects when the picker is not loaded', async () => {
    await expect(lib.openPicker(config, 'form')).rejects.toThrow();
  });

  it('openPicker resolves the picked doc and null on cancel', async () => {
    let callback: (r: GooglePickerResponse) => void = () => {};
    const builder: GooglePickerBuilder = {
      addView: () => builder,
      setOAuthToken: () => builder,
      setDeveloperKey: () => builder,
      setAppId: () => builder,
      setCallback: (cb) => { callback = cb; return builder; },
      build: () => ({ setVisible: vi.fn() }),
    };
    const view = { setMimeTypes: () => view, setIncludeFolders: () => view } as GoogleDocsView;
    window.google = {
      picker: {
        PickerBuilder: function () { return builder; } as never,
        DocsView: function () { return view; } as never,
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
      },
    };
    const picked = lib.openPicker(config, 'sheet');
    callback({ action: 'picked', docs: [{ id: 's1', name: 'Sheet' }] });
    await expect(picked).resolves.toEqual({ id: 's1', name: 'Sheet' });
    const cancelled = lib.openPicker(config, 'form');
    callback({ action: 'cancel' });
    await expect(cancelled).resolves.toBeNull();
  });
});
