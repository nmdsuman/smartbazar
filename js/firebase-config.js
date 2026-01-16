// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAcj9y2jgxqatG3_IXkBjMT0yvBoardpJw",
  authDomain: "bazar-201e6.firebaseapp.com",
  projectId: "bazar-201e6",
  storageBucket: "bazar-201e6.firebasestorage.app",
  messagingSenderId: "465394666878",
  appId: "1:465394666878:web:d11979e97a733527aef72f",
  measurementId: "G-X3NVQEBFNM"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const auth = getAuth(app);
export const db = getFirestore(app);
