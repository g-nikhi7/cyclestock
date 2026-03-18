import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBREva2czcU_oHKCAaJ1Qk815Cw6O68sx4",
  authDomain: "cyclestock-f94f4.firebaseapp.com",
  projectId: "cyclestock-f94f4",
  storageBucket: "cyclestock-f94f4.firebasestorage.app",
  messagingSenderId: "1033189799460",
  appId: "1:1033189799460:web:d7ee9ea5fe5a4bddfd8ab1",
  measurementId: "G-70D3W3V4FB"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);