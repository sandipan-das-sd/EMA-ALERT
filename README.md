# EMA Alert (MERN)

A clean, modern MERN starter wired for a strategy alert system for the Indian Stock Market (Upstox integration to be added next).

## What’s included

- Backend: Node + Express + Mongoose, cookie-based JWT auth, robust MongoDB SRV/DNS options
- Frontend: React (Vite) + TailwindCSS + Inter font, clean UX
- Auth: Sign up, Log in, Me, Logout
- Dashboard: Sidebar + main area layout

## Environment

Backend `.env` created at `server/.env`:

- MONGO_URI: set to your provided Cluster0 connection with `ema_alert` DB
- JWT_SECRET: placeholder, change in production
- COOKIE_NAME: `ema_jwt`
- PORT: `4000`

Frontend `.env` created at `client/.env`:

- VITE_API_URL: `http://localhost:4000`

## Run locally (Windows PowerShell)

1. Install dependencies

```powershell
# Backend
cd server; npm install; cd ..

# Frontend
cd client; npm install; cd ..

# Root helper tool
npm install
```

2. Start both dev servers

```powershell
npm run dev
```

- Backend: http://localhost:4000
- Frontend: http://localhost:5173

## Notes on MongoDB SRV/DNS reliability

The backend uses Mongoose with:
- `family: 4` (forces IPv4)
- reasonable `serverSelectionTimeoutMS`, `connectTimeoutMS`, and `socketTimeoutMS`

These settings mitigate common SRV/DNS issues on Windows/ISP combos. If you still face resolution problems, try:
- Ensuring your network/DNS can resolve `*.mongodb.net`
- Using a stable DNS (e.g., 1.1.1.1 or 8.8.8.8)
- Temporarily using a VPN to test connectivity

## API endpoints

- POST `/api/auth/signup` { email, password }
- POST `/api/auth/login` { email, password }
- GET `/api/auth/me`
- POST `/api/auth/logout`

Auth token is stored as an httpOnly cookie.

## Next steps

- Add Upstox OAuth and brokerage connectivity
- Strategy builders, backtests, and alert delivery
- Role-based access controls and audit logs
- Production hardening: rate limiting, CSRF, refresh tokens
