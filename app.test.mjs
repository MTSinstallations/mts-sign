import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
function harness(response) {
  const calls = [];
  const context = vm.createContext({
    calls, URL, URLSearchParams, Response, AbortController,
    document: { readyState: 'loading', getElementById: () => ({}), addEventListener() {} },
    window: { location: { search: '?t=synthetic-token' }, setTimeout, clearTimeout },
    fetch: async (url) => {
      assert.equal(url, 'https://djduaqegxwjnmjlzjdor.supabase.co/functions/v1/costco-signoff-sign');
      return response;
    },
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    renderAlreadySigned = () => calls.push('signed'); renderThanks = () => calls.push('thanks');
    renderProcessing = () => calls.push('processing'); renderExpired = () => calls.push('expired');
    renderInvalid = () => calls.push('invalid'); renderLoadError = () => calls.push('error');
    setSignButton = () => {}; setFormError = () => calls.push('error');
  `, context);
  return { calls, context };
}
test('a reserved or failed save never renders Already signed', async () => {
  for (const code of [423, 502]) {
    const h = harness(Response.json({ status: 'processing' }, { status: code }));
    await vm.runInContext("postSignature('synthetic-signature')", h.context);
    assert.deepEqual(h.calls, ['processing']);
  }
});
test('a generic conflict is not proof of signing', async () => {
  const h = harness(Response.json({ error: 'other_conflict' }, { status: 409 }));
  await vm.runInContext("postSignature('synthetic-signature')", h.context);
  assert.deepEqual(h.calls, ['error']);
});
test('only confirmed signed responses show success', async () => {
  for (const [code, expected] of [[200, 'thanks'], [409, 'signed']]) {
    const h = harness(Response.json({ status: 'signed', signed_at: '2026-11-02T18:00:00Z' }, { status: code }));
    await vm.runInContext("postSignature('synthetic-signature')", h.context);
    assert.deepEqual(h.calls, [expected]);
  }
});
test('loading a claimed record shows pending confirmation without another signing form', async () => {
  const h = harness();
  h.context.response = Response.json({ status: 'processing' }, { status: 423 });
  await vm.runInContext('handleLoadResponse(response, 0)', h.context);
  assert.deepEqual(h.calls, ['processing']);
});
