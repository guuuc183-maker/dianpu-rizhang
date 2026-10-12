// Firebase 数据层：登录、店铺、邀请码、营业额记录（实时同步 + 离线缓存）
import { firebaseConfig } from './config.js';
import {
  initializeApp,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch,
  arrayUnion, arrayRemove, deleteField, serverTimestamp,
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged,
  connectFirestoreEmulator, connectAuthEmulator
} from './firebase.js';

// 仅本机测试用：http://localhost/?emu 连接 Firebase 模拟器
const EMU = location.hostname === 'localhost' && new URLSearchParams(location.search).has('emu');

let db, auth;

export function configured() {
  if (EMU) return true;
  return firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('在这里');
}

export function init() {
  const app = initializeApp(EMU ? { apiKey: 'demo', projectId: 'demo-zhangfang', authDomain: 'localhost' } : firebaseConfig);
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = initializeFirestore(app, {});
  }
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver
  });
  if (EMU) {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  getRedirectResult(auth).catch(() => {});
}

// ---------- 登录 ----------
export function onUser(cb) { return onAuthStateChanged(auth, cb); }

export async function loginGoogle() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, p);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, p);
    } else throw e;
  }
}
export const loginEmail = (email, pw) => signInWithEmailAndPassword(auth, email.trim(), pw);
export const registerEmail = (email, pw) => createUserWithEmailAndPassword(auth, email.trim(), pw);
export const resetPassword = email => sendPasswordResetEmail(auth, email.trim());
export const logout = () => signOut(auth);

// ---------- 店铺 ----------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉了容易看错的 0/O、1/I
function genCode() {
  let s = '';
  const r = crypto.getRandomValues(new Uint32Array(6));
  for (let i = 0; i < 6; i++) s += CODE_CHARS[r[i] % CODE_CHARS.length];
  return s;
}
async function freeCode() {
  for (let i = 0; i < 10; i++) {
    const c = genCode();
    const snap = await getDocFromServer(doc(db, 'codes', c));
    if (!snap.exists()) return c;
  }
  throw new Error('生成邀请码失败，请重试');
}

export async function getMyShopId(uid) {
  const s = await getDoc(doc(db, 'users', uid));
  return s.exists() ? s.data().shopId : null;
}

export async function createShop(uid, shopName, myName) {
  const shopRef = doc(collection(db, 'shops'));
  const code = await freeCode();
  const b = writeBatch(db);
  b.set(shopRef, {
    name: shopName, code, owner: uid, memberIds: [uid],
    members: { [uid]: { name: myName, joinedAt: Date.now() } },
    createdAt: serverTimestamp()
  });
  b.set(doc(db, 'codes', code), { shopId: shopRef.id });
  b.set(doc(db, 'users', uid), { shopId: shopRef.id });
  await b.commit();
  return shopRef.id;
}

export async function joinShop(uid, code, myName) {
  code = code.trim().toUpperCase();
  const c = await getDocFromServer(doc(db, 'codes', code));
  if (!c.exists()) throw new Error('邀请码不对');
  const shopId = c.data().shopId;
  await updateDoc(doc(db, 'shops', shopId), {
    memberIds: arrayUnion(uid),
    ['members.' + uid]: { name: myName, joinedAt: Date.now() },
    joinedWith: code
  });
  await setDoc(doc(db, 'users', uid), { shopId });
  return shopId;
}

export function watchShop(shopId, cb, onErr) {
  return onSnapshot(doc(db, 'shops', shopId), s => {
    if (!s.exists()) { onErr(new Error('店铺不存在')); return; }
    cb(Object.assign({ id: s.id }, s.data()));
  }, onErr);
}

export async function resetCode(shop) {
  const code = await freeCode();
  const b = writeBatch(db);
  b.delete(doc(db, 'codes', shop.code));
  b.set(doc(db, 'codes', code), { shopId: shop.id });
  b.update(doc(db, 'shops', shop.id), { code });
  await b.commit();
}

export function renameShop(shopId, name) {
  return updateDoc(doc(db, 'shops', shopId), { name });
}

export function kick(shopId, uid) {
  return updateDoc(doc(db, 'shops', shopId), { memberIds: arrayRemove(uid), ['members.' + uid]: deleteField() });
}

export async function leave(shopId, uid) {
  await updateDoc(doc(db, 'shops', shopId), { memberIds: arrayRemove(uid), ['members.' + uid]: deleteField() });
  await deleteDoc(doc(db, 'users', uid));
}

export function forgetShop(uid) {
  return deleteDoc(doc(db, 'users', uid)).catch(() => {});
}

// ---------- 营业额记录 ----------
export function watchRecords(shopId, cb, onErr) {
  return onSnapshot(collection(db, 'shops', shopId, 'records'), { includeMetadataChanges: true }, snap => {
    const map = {};
    snap.forEach(d => {
      const x = d.data();
      map[d.id] = { cash: x.cash || 0, card: x.card || 0, note: x.note || '', by: x.by || '' };
    });
    cb(map, { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache });
  }, onErr);
}

// 不等待服务器确认：离线时先存本机，有网自动上传
export function saveRecord(shopId, date, rec) {
  return setDoc(doc(db, 'shops', shopId, 'records', date), {
    cash: rec.cash, card: rec.card, note: rec.note || '', by: rec.by || '', updatedAt: serverTimestamp()
  });
}

export function deleteRecord(shopId, date) {
  return deleteDoc(doc(db, 'shops', shopId, 'records', date));
}
