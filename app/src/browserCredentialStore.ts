// Owner-authorized device-local credential storage. Never include this database in exports.
const DATABASE = 'image-studio-credentials';
export async function credentialStore(operation: 'read' | 'write' | 'delete', value?: string): Promise<string | null> {
  return navigator.locks.request('image-studio-credentials', async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('credentials');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => reject(new Error('Credential storage is unavailable.'));
    });
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const transaction = database.transaction('credentials', operation === 'read' ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('credentials');
        const request = operation === 'read' ? store.get('openai') : operation === 'write' ? store.put(value, 'openai') : store.delete('openai');
        transaction.oncomplete = () => resolve(operation === 'read' && typeof request.result === 'string' ? request.result : null);
        transaction.onerror = transaction.onabort = () => reject(new Error('Credential storage operation failed.'));
      });
    } finally { database.close(); }
  });
}
