import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Watchlist from './pages/Watchlist.jsx';
import Notes from './pages/Notes.jsx';
import { getMe } from './lib/api.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    getMe().then((u) => {
      if (!active) return;
      setUser(u);
      setLoading(false);
    });
    const timeout = setTimeout(() => {
      if (active && loading) setLoading(false); // failsafe to avoid infinite loading
    }, 4000);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, []);

  function handleAuthed(u) {
    setUser(u);
    navigate('/dashboard');
  }

  if (loading) return <div className="p-10 text-center">Loading...</div>;

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/dashboard" /> : <Landing />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login onAuthed={handleAuthed} />} />
      <Route path="/signup" element={user ? <Navigate to="/dashboard" /> : <Signup onAuthed={handleAuthed} />} />
      <Route path="/dashboard" element={user ? <Dashboard user={user} setUser={setUser} /> : <Navigate to="/" />} />
      <Route path="/watchlist" element={user ? <Watchlist user={user} /> : <Navigate to="/" />} />
      <Route path="/notes" element={user ? <Notes /> : <Navigate to="/" />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
