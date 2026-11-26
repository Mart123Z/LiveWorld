// Stockage : mode local (IndexedDB du navigateur) ou Firebase (Firestore + cache local)
import { docId } from './util.js';

export const COLLECTIONS = ['events', 'links', 'briefings', 'markets', 'batches'];
export const emptyDb = () => Object.fromEntries(COLLECTIONS.map(c => [c, {}]));

// ---------- IndexedDB minimal ----------
const idb = {
  _db: null,
  open() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      const r = indexedDB.open('liveworld', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
};

function applyChanges(db, changes) {
  for (const c of COLLECTIONS) for (const d of changes[c] || []) {
    if (d._deleted) delete db[c][d.id]; else db[c][d.id] = d;
  }
}

// ---------- Mode local ----------
export class LocalStore {
  constructor() { this.mode = 'local'; this.user = null; }
  async init() { return true; }
  async load() { const db = (await idb.get('db')) || emptyDb(); for (const c of COLLECTIONS) db[c] ||= {}; this.db = db; return db; }
  async save(changes) { applyChanges(this.db, changes); await idb.set('db', this.db); }
  async replaceAll(db) { this.db = db; await idb.set('db', db); }
  static async peekLocal() { return (await idb.get('db')) || emptyDb(); }
}

// ---------- Mode Firebase ----------
// Chaque document Firestore = { json: "<objet sérialisé>", _ts: <horodatage ms>, deleted: bool }
// sous users/{uid}/{collection}/{id}. Sérialiser évite les limites Firestore (tableaux imbriqués des tableaux/graphes).
export class FirebaseStore {
  constructor(config) { this.mode = 'firebase'; this.config = config; this.user = null; this.fb = null; }
  async init(onUser) {
    this.fb = await import('../vendor/firebase.js');
    const { initializeApp, getAuth, getFirestore, onAuthStateChanged, setPersistence, browserLocalPersistence } = this.fb;
    this.app = initializeApp(this.config);
    this.auth = getAuth(this.app);
    try { await setPersistence(this.auth, browserLocalPersistence); } catch {}
    this.fs = getFirestore(this.app);
    return new Promise(res => {
      let first = true;
      onAuthStateChanged(this.auth, u => { this.user = u; if (first) { first = false; res(true); } else onUser?.(u); });
    });
  }
  async signIn(email, password) { const r = await this.fb.signInWithEmailAndPassword(this.auth, email, password); this.user = r.user; return r.user; }
  async signOut() { await this.fb.signOut(this.auth); this.user = null; }
  get cacheKey() { return 'fb:' + (this.user?.uid || 'anon'); }
  col(c) { return this.fb.collection(this.fs, 'users', this.user.uid, c); }

  async load() {
    if (!this.user) throw new Error('Non connecté');
    const { getDocs, query, where } = this.fb;
    const cache = (await idb.get(this.cacheKey)) || { db: emptyDb(), lastSync: 0 };
    const db = cache.db; for (const c of COLLECTIONS) db[c] ||= {};
    let max = cache.lastSync;
    await Promise.all(COLLECTIONS.map(async c => {
      const snap = await getDocs(query(this.col(c), where('_ts', '>', cache.lastSync)));
      snap.forEach(d => {
        const v = d.data(); max = Math.max(max, v._ts || 0);
        if (v.deleted) delete db[c][d.id];
        else { try { const o = JSON.parse(v.json); db[c][o.id || d.id] = o; } catch {} }
      });
    }));
    this.db = db;
    await idb.set(this.cacheKey, { db, lastSync: max });
    return db;
  }

  async save(changes) {
    const { writeBatch, doc } = this.fb;
    const ops = [];
    for (const c of COLLECTIONS) for (const d of changes[c] || []) ops.push([c, d]);
    const now = Date.now();
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(this.fs);
      ops.slice(i, i + 400).forEach(([c, d], j) => {
        const ref = doc(this.fs, 'users', this.user.uid, c, docId(d.id));
        b.set(ref, d._deleted ? { deleted: true, _ts: now + i + j, json: '' } : { json: JSON.stringify(d), _ts: now + i + j, deleted: false });
      });
      await b.commit();
    }
    applyChanges(this.db, changes);
    const cache = (await idb.get(this.cacheKey)) || { lastSync: 0 };
    await idb.set(this.cacheKey, { db: this.db, lastSync: cache.lastSync });
  }

  async replaceAll(db) {
    const changes = {};
    for (const c of COLLECTIONS) {
      changes[c] = Object.values(db[c] || {});
      for (const id of Object.keys(this.db[c] || {})) if (!db[c]?.[id]) changes[c].push({ id, _deleted: true });
    }
    await this.save(changes);
  }
}
