import React, { createContext, useContext, useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const login = async (email, password) => {
    // Demo Fast-Login Bypass for quick testing
    if (email === "admin@yuta.com" && password === "password123") {
      const demoAdmin = {
        uid: "demo-admin-01",
        email: "admin@yuta.com",
        fullname: "Plant Admin",
        role: "Admin"
      };
      setCurrentUser(demoAdmin);
      return demoAdmin;
    }

    if (email === "employee@yuta.com" && password === "password123") {
      const demoEmployee = {
        uid: "demo-employee-01",
        email: "employee@yuta.com",
        fullname: "Floor Technician",
        role: "Employee"
      };
      setCurrentUser(demoEmployee);
      return demoEmployee;
    }

    const res = await signInWithEmailAndPassword(auth, email, password);
    const userDoc = await getDoc(doc(db, "users", res.user.uid));
    const userData = userDoc.exists() ? userDoc.data() : { role: "Employee", fullname: email };
    
    const loggedInUser = {
      uid: res.user.uid,
      email: res.user.email,
      ...userData
    };
    setCurrentUser(loggedInUser);
    return loggedInUser;
  };

  const logout = async () => {
    if (currentUser?.uid?.startsWith("demo-")) {
      setCurrentUser(null);
      return;
    }
    await signOut(auth);
    setCurrentUser(null);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.exists() ? userDoc.data() : { role: "Employee", fullname: user.email };
        setCurrentUser({
          uid: user.uid,
          email: user.email,
          ...userData
        });
      } else {
        if (!currentUser?.uid?.startsWith("demo-")) {
          setCurrentUser(null);
        }
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, login, logout, isAdmin: currentUser?.role === 'Admin' }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};