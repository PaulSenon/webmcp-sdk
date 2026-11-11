// Feature detection happens before importing the polyfill in every document.
export const native = 'modelContext' in document;
export const mode = new URLSearchParams(location.search).get('mode') ?? 'polyfill';
export const platform = { native, mode, available: false };
Object.assign(window, { platform });
if (mode === 'polyfill') {
  if (native) throw new Error('Polyfill project requires native modelContext to be absent');
  const { installWebMCP } = await import('@w3c/webmcp-polyfill');
  installWebMCP();
}
platform.available = 'modelContext' in document;
