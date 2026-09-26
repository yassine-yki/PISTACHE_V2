import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
function setup(login, resendConfirmation = async () => {}) {
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', hidden: false, disabled: false, textContent: '',
      classList: { add() {}, remove() {} }, focus() {},
    });
    return elements.get(selector);
  };
  const context = vm.createContext({ document: { querySelector: get }, login, resendConfirmation, beginCloud: async () => {}, Date });
  vm.runInContext('let registrationMode=false;\n' + source.slice(source.indexOf('function setRegistrationMode('), source.indexOf('document.querySelector("#syncButton").onclick')), context);
  get('#toggleRegister').onclick();
  get('#loginEmail').value = 'person@entreprise.net';
  get('#loginPassword').value = 'test-password';
  return { get, submit: () => get('#loginForm').onsubmit({ preventDefault() {} }) };
}
test('pending signup replaces form, clears password and supports resend and login', async () => {
  let recipient;
  const { get, submit } = setup(async () => null, async email => { recipient = email; });
  await submit();
  assert.equal(get('#loginForm').hidden, true);
  assert.equal(get('#verifyAccount').hidden, false);
  assert.equal(get('#loginError').hidden, true);
  assert.equal(get('#loginPassword').value, '');
  assert.equal(get('#verificationEmail').textContent, 'person@entreprise.net');
  await get('#resendConfirmation').onclick();
  assert.equal(recipient, 'person@entreprise.net');
  get('#backToLogin').onclick();
  assert.equal(get('#verifyAccount').hidden, true);
  assert.equal(get('#loginForm').hidden, false);
  assert.equal(get('#loginSubmit').textContent, 'Se connecter');
});
test('signup errors keep the form usable without showing confirmation', async () => {
  const { get, submit } = setup(async () => { throw new Error('Email rate limit exceeded'); });
  await submit();
  assert.equal(get('#verifyAccount').hidden, true);
  assert.equal(get('#loginForm').hidden, false);
  assert.equal(get('#loginError').textContent, 'Email rate limit exceeded');
  assert.equal(get('#loginSubmit').disabled, false);
});
test('resend failure is visible and allows retry', async () => {
  const { get, submit } = setup(async () => null, async () => { throw new Error('SMTP unavailable'); });
  await submit();
  await get('#resendConfirmation').onclick();
  assert.match(get('#verificationMessage').textContent, /SMTP unavailable/);
  assert.equal(get('#resendConfirmation').disabled, false);
});
