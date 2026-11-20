import React, { createContext, useContext, useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const login = async (email, password, accountProfile) => {
    if (accountProfile) {
      setCurrentUser(accountProfile);
      return accountProfile;
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
        setCurrentUser(null);
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