import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { login } from '../lib/api.js';

export default function Login({ onAuthed }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      onAuthed(user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="card max-w-md w-full">
        <h2 className="text-2xl font-semibold mb-6">Log in</h2>
        {error && <div className="mb-4 text-red-600 text-sm">{error}</div>}
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="block text-sm mb-1">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm mb-1">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn-primary w-full" disabled={loading}>{loading ? 'Logging in…' : 'Log in'}</button>
        </form>
        <p className="mt-4 text-sm text-slate-600">
          New here? <Link to="/signup" className="text-brand hover:underline">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
