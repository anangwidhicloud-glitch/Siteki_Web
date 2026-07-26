import { initializeApp, getApps } from "firebase/app";
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  serverTimestamp
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

export async function getFirestoreCollection(name) {
  const snapshot = await getDocs(collection(db, name));
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function addFirestoreDocument(name, data) {
  const ref = await addDoc(collection(db, name), {
    ...data,
    createdAt: serverTimestamp()
  });
  return ref.id;
}
