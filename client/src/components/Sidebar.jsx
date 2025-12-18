import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export default function Sidebar() {
  const { pathname } = useLocation();
  const item = (to, label) => (
    <Link
      to={to}
      className={
        'block rounded px-3 py-2 hover:bg-slate-100 ' +
        (pathname === to ? 'bg-slate-100 font-medium' : '')
      }
    >
      {label}
    </Link>
  );
  return (
    <aside className="w-64 bg-white border-r border-slate-200 p-4">
      <div className="text-lg font-semibold mb-6 text-brand">EMA Alert</div>
      <nav className="space-y-2">
        {item('/dashboard', 'Dashboard')}
        {item('/watchlist', 'Watchlist')}
        {item('/notes', 'Notes')}
        {item('/notifications', 'Notifications')}
        {item('/settings', 'Settings')}
      </nav>
    </aside>
  );
}
