const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../electron/store.cjs');
test('Without a secure keyring passwords stay in memory and are never returned to the renderer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amt-store-test-'));
  try {
    const safeStorage = { isEncryptionAvailable: () => false };
    const store = new Store(dir, safeStorage);
    const [device] = store.save({ name:'Test', host:'127.0.0.1', username:'admin', password:'test-password-never-persist', remember:true });
    assert.equal(await store.password(device.id), 'test-password-never-persist');
    assert.equal(device.hasPassword,true);
    assert.ok(!JSON.stringify(store.list()).includes('test-password-never-persist'));
    assert.ok(!fs.readFileSync(path.join(dir,'devices.json'),'utf8').includes('test-password-never-persist'));
    assert.equal(new Store(dir,safeStorage).list()[0].hasPassword,false);
    store.trust(device.id,'ab'.repeat(32));
    store.save({ ...device, host:'127.0.0.2' });
    assert.equal(store.get(device.id).fingerprint,undefined);
    await assert.rejects(store.password(device.id), /Kennwort/);
  } finally { fs.rmSync(dir, { recursive:true }); }
});
test('Linux basic_text keyring fallback never persists credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amt-store-test-'));
  try {
    const store = new Store(dir, { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text', encryptString: () => { throw new Error('must not be called'); } });
    store.save({name:'Test',host:'localhost',username:'admin',password:'test',remember:true});
    assert.equal(store.encryptionAvailable(),false);
  } finally { fs.rmSync(dir, { recursive:true }); }
});
