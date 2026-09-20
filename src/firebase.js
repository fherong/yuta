import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAqyNFBqFhcCsqRvvtkmgUBn7lzJ0NwkWI",
  authDomain: "yuta-db.firebaseapp.com",
  databaseURL: "https://yuta-db-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "yuta-db",
  storageBucket: "yuta-db.firebasestorage.app",
  messagingSenderId: "704388717293",
  appId: "1:704388717293:web:7c3633ff1257dcaec90ae4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export both the Realtime Database and Auth instances
export const db = getDatabase(app);
export const auth = getAuth(app);
export default app;