import { initializeApp, getApps } from "firebase/app";
import {
  collection,
  getDocs,
  getFirestore
} from "firebase/firestore";
import googleServices from "../config/google-services.json" with { type: "json" };

const projectInfo = googleServices.project_info;
const androidClient = googleServices.client[0];

const firebaseConfig = {
  apiKey: androidClient.api_key[0].current_key,
  projectId: projectInfo.project_id,
  storageBucket: projectInfo.storage_bucket,
  appId: androidClient.client_info.mobilesdk_app_id,
  authDomain: `${projectInfo.project_id}.firebaseapp.com`,
  messagingSenderId: projectInfo.project_number
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app);
const collectionCache = new Map();
const collectionRequests = new Map();

export async function getFirestoreCollection(name, options = {}) {
  const ttl = options.cacheTtl ?? 10 * 60 * 1000;
  const cached = collectionCache.get(name);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) return cached.rows;
  if (!options.forceRefresh && collectionRequests.has(name)) return collectionRequests.get(name);
  const request = getDocs(collection(db,name))
    .then(snapshot => {
      const rows=snapshot.docs.map(doc=>({id:doc.id,...doc.data()}));
      collectionCache.set(name,{rows,expiresAt:Date.now()+ttl});
      return rows;
    })
    .finally(()=>collectionRequests.delete(name));
  collectionRequests.set(name,request);
  return request;
}

export function invalidateFirestoreCollection(name) {
  if (name) collectionCache.delete(name);
  else collectionCache.clear();
}
