import React from 'react';
import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full space-y-8 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-brand">EMA Alert System</h1>
        <p className="text-slate-600">Real-time strategy alerts for Indian Stock Market leveraging Upstox API. Stay ahead with precision.</p>
        <div className="flex gap-4 justify-center">
          <Link to="/signup" className="btn-primary w-32">Sign Up</Link>
          <Link to="/login" className="btn-primary w-32 bg-accent hover:bg-amber-500">Log In</Link>
        </div>
      </div>
    </div>
  );
}
