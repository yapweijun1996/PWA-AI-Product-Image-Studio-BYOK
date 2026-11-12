import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBObjectStore} from 'fake-indexeddb';
import {credentialStore} from '../src/browserCredentialStore.ts';
globalThis.indexedDB=indexedDB;
Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{request:async(_name,fn)=>fn()}});
test('dedicated credentials survive a read, can be replaced and explicitly removed',async()=>{
 await credentialStore('delete');assert.equal(await credentialStore('read'),null);
 await credentialStore('write','sk-synthetic-store-key-one');assert.equal(await credentialStore('read'),'sk-synthetic-store-key-one');
 await credentialStore('write','sk-synthetic-store-key-two');assert.equal(await credentialStore('read'),'sk-synthetic-store-key-two');
 await credentialStore('delete');assert.equal(await credentialStore('read'),null);
});
test('failed persistence rejects without overwriting the saved credential',async()=>{
 await credentialStore('write','sk-synthetic-existing-key');const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(){throw new DOMException('synthetic quota','QuotaExceededError')};
 try{await assert.rejects(()=>credentialStore('write','sk-synthetic-replacement-key'));}finally{IDBObjectStore.prototype.put=put}
 assert.equal(await credentialStore('read'),'sk-synthetic-existing-key');await credentialStore('delete');
});
