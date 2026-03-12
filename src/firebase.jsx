// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBREva2czcU_oHKCAaJ1Qk815Cw6O68sx4",
  authDomain: "cyclestock-f94f4.firebaseapp.com",
  projectId: "cyclestock-f94f4",
  storageBucket: "cyclestock-f94f4.firebasestorage.app",
  messagingSenderId: "1033189799460",
  appId: "1:1033189799460:web:d7ee9ea5fe5a4bddfd8ab1",
  measurementId: "G-70D3W3V4FB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);