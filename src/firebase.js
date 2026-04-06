import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCyUwRravp04s5pRQjymgQi0hKwZ4xOxEU",
  authDomain: "whatsappchatread.firebaseapp.com",
  projectId: "whatsappchatread",
  storageBucket: "whatsappchatread.firebasestorage.app",
  messagingSenderId: "444573324215",
  appId: "1:444573324215:web:9d7e0f07e5ea3374694e32",
  measurementId: "G-FWHD25VXNZ"
};


const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);