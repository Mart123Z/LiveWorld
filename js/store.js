// Stockage : mode local (IndexedDB du navigateur) ou Firebase (Firestore + cache local)
import { docId } from './util.js?v=202611272136';

export const COLLECTIONS = ['events', 'links', 'briefings', 'markets', 'batches'];
export const emptyDb = () => Object.fromEntries(COLLECTIONS.map(c => [c, {}]));

// ---------- IndexedDB minimal ----------
const idb = {
  _db: null,
  // Si IndexedDB est indisponible ou bloqué (navigation privée stricte, mode Isolement…), on bascule en mémoire
  open() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('IndexedDB ne répond pas')), 4000);
      try {
        const r = indexedDB.open('liveworld', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { clearTimeout(t); res(r.result); }; r.onerror = () => { clearTimeout(t); rej(r.error); };
        r.onblocked = () => { clearTimeout(t); rej(new Error('IndexedDB bloqué')); };
      } catch (e) { clearTimeout(t); rej(e); }
    }).catch(e => { console.warn('Stockage en mémoire :', e); this.mem = true; return null; });
    return this._db;
  },
  mem: false, memStore: {},
  async get(k) { const db = await this.open(); if (!db) return this.memStore[k]; return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); if (!db) { this.memStore[k] = v; return; } return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
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
  async getConfig(name) { return (await idb.get('config:' + name)) || null; }
  async setConfig(name, data) { await idb.set('config:' + name, data); }
  static async peekLocal() { return (await idb.get('db')) || emptyDb(); }
}

// ---------- Mode Firebase ----------
// Base partagée : spaces/main/{collection}/{id} = { json: "<objet sérialisé>", _ts: <ms>, deleted: bool }
// Sérialiser évite les limites Firestore (tableaux imbriqués des tableaux et graphiques).
// Comptes : users/{uid} = { username, role: admin|editor|reader, disabled, created_at, created_by, last_login_at }
export const ROLES = { admin: 'Administrateur', editor: 'Éditeur', reader: 'Lecteur' };
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,29}$/;
const SPACE = ['spaces', 'main'];

export class FirebaseStore {
  constructor(config) { this.mode = 'firebase'; this.config = config; this.user = null; this.profile = null; this.fb = null; }
  get domain() { return this.config.authDomain; }
  get rootEmail() { return 'admin@' + this.domain; }
  toEmail(username) { const u = String(username || '').trim().toLowerCase(); return u.includes('@') ? u : `${u}@${this.domain}`; }
  usernameOf(email) { const e = String(email || '').toLowerCase(); return e.endsWith('@' + this.domain) ? e.slice(0, -this.domain.length - 1) : e; }
  get role() { return this.profile?.role || null; }

  async init(onUser) {
    this.fb = await import('../vendor/firebase.js?v=202611272136');
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
  async signIn(username, password) { const r = await this.fb.signInWithEmailAndPassword(this.auth, this.toEmail(username), password); this.user = r.user; return r.user; }
  async signOut() { await this.fb.signOut(this.auth); this.user = null; this.profile = null; await idb.set(this.cacheKey, null).catch(() => {}); }

  // Profil du compte connecté. L'Admin racine crée son propre profil à la première connexion.
  async loadProfile() {
    const { doc, getDoc, setDoc, updateDoc } = this.fb;
    const ref = doc(this.fs, 'users', this.user.uid);
    let snap = await getDoc(ref);
    if (!snap.exists() && this.user.email?.toLowerCase() === this.rootEmail) {
      await setDoc(ref, { username: 'admin', role: 'admin', disabled: false, created_at: new Date().toISOString(), created_by: 'auto' });
      snap = await getDoc(ref);
    }
    this.profile = snap.exists() ? { uid: this.user.uid, ...snap.data() } : null;
    if (this.profile && this.user.email?.toLowerCase() === this.rootEmail) this.profile.role = 'admin';
    if (this.profile && !this.profile.disabled) updateDoc(ref, { last_login_at: new Date().toISOString() }).catch(() => {});
    return this.profile;
  }

  // ----- Gestion des comptes (Admin) -----
  async listUsers() {
    const snap = await this.fb.getDocs(this.fb.collection(this.fs, 'users'));
    const out = []; snap.forEach(d => out.push({ uid: d.id, ...d.data() }));
    return out.sort((a, b) => String(a.username).localeCompare(String(b.username)));
  }
  // Création sans Cloud Functions : une 2e instance Firebase (mémoire seule) crée le compte,
  // pour que l'Admin reste connecté ; l'Admin écrit ensuite le profil (autorisé par les règles).
  async createUser(username, password, role) {
    const { initializeApp, deleteApp, initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, signOut, doc, setDoc } = this.fb;
    const u = String(username).trim().toLowerCase();
    if (!USERNAME_RE.test(u)) throw new Error('Identifiant invalide (2 à 30 caractères : lettres minuscules, chiffres, . _ -).');
    if (!ROLES[role]) throw new Error('Rôle invalide.');
    const sec = initializeApp(this.config, 'creation-' + Date.now());
    try {
      const secAuth = initializeAuth(sec, { persistence: inMemoryPersistence });
      const cred = await createUserWithEmailAndPassword(secAuth, this.toEmail(u), password);
      await setDoc(doc(this.fs, 'users', cred.user.uid), { username: u, role, disabled: false, created_at: new Date().toISOString(), created_by: this.profile?.username || 'admin' });
      await signOut(secAuth);
      return cred.user.uid;
    } finally { await deleteApp(sec).catch(() => {}); }
  }
  // Réglages partagés (config/{name}) : lisibles par les comptes actifs, modifiables par l'Admin
  async getConfig(name) { const d = await this.fb.getDoc(this.fb.doc(this.fs, 'config', name)); return d.exists() ? d.data() : null; }
  async setConfig(name, data) { await this.fb.setDoc(this.fb.doc(this.fs, 'config', name), data); }
  async updateUser(uid, patch) { await this.fb.updateDoc(this.fb.doc(this.fs, 'users', uid), patch); }
  async deleteProfile(uid) { await this.fb.deleteDoc(this.fb.doc(this.fs, 'users', uid)); }
  async changePassword(current, next) {
    const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = this.fb;
    await reauthenticateWithCredential(this.user, EmailAuthProvider.credential(this.user.email, current));
    await updatePassword(this.user, next);
  }

  // ----- Données partagées -----
  get cacheKey() { return 'fb:' + SPACE.join('/'); }
  col(c) { return this.fb.collection(this.fs, ...SPACE, c); }

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
        const ref = doc(this.fs, ...SPACE, c, docId(d.id));
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
