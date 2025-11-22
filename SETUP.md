# Quick Setup Guide

## 1. Generate VAPID Keys

```bash
npx web-push generate-vapid-keys
```

Copy the public and private keys to your `docker-compose.yml` or `.env` file.

## 2. Create PWA Icons

You need to create two icon files:
- `frontend/public/icon-192x192.png` (192x192 pixels)
- `frontend/public/icon-512x512.png` (512x512 pixels)

**Quick way to create icons:**

1. Create a simple image with a bell icon (use any design tool)
2. Export as PNG with the required sizes
3. Place them in `frontend/public/` directory

**Or use online tools:**
- https://realfavicongenerator.net/
- https://www.pwabuilder.com/imageGenerator

## 3. Start Docker Services

```bash
docker-compose up --build
```

## 4. Access the Application

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- Health Check: http://localhost:3000/health

## 5. First Steps

1. Register a new account
2. Grant notification permission when prompted
3. Schedule a notification
4. Install the PWA when prompted (optional but recommended)

## Troubleshooting

**Push notifications not working?**
- Make sure VAPID keys are set correctly
- Check browser console for errors
- Ensure notification permission is granted

**Database connection errors?**
- Wait for PostgreSQL to be fully healthy (check with `docker-compose ps`)
- Verify DATABASE_URL in docker-compose.yml

**CORS errors?**
- Ensure frontend is using correct API URL
- Check backend CORS settings

