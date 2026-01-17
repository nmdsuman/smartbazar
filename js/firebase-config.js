// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCbZUXA2jzfCscXzVY8_OuWUjiCDGN0QZk",
  authDomain: "smartbazarbd.firebaseapp.com",
  projectId: "smartbazarbd",
  storageBucket: "smartbazarbd.firebasestorage.app",
  messagingSenderId: "6260451319",
  appId: "1:6260451319:web:6e5e210d7a8127b1d3f0f2",
  measurementId: "G-RJ0JGF43G5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const auth = getAuth(app);
export const db = getFirestore(app);
