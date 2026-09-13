import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAqNFBqFhcCsqRvvkmgUBn7lzJ0NwkWI",
  authDomain: "yuta-db.firebaseapp.com",
  projectId: "yuta-db",
  storageBucket: "yuta-db.firebasestorage.app",
  messagingSenderId: "704388717293",
  appId: "1:704388717293:web:7c3633ff1257dcaec90ae4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);