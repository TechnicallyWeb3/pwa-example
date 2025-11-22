# PWA Notification App

A full-stack Progressive Web App (PWA) with time-based push notifications, user authentication, and notification logging.

## Features

- ✅ User registration and login
- ✅ Time-based push notifications
- ✅ Daily repeat notifications
- ✅ Notification logs
- ✅ PWA install flow
- ✅ Mobile-friendly design
- ✅ Docker containerization
- ✅ PostgreSQL database

## Prerequisites

- Docker and Docker Compose installed
- Node.js 18+ (for local development)

## Setup

1. **Generate VAPID keys for push notifications** (required):

```bash
npx web-push generate-vapid-keys
```

This will output a public and private key. Add them to `docker-compose.yml` environment variables or create a `.env` file:

```
VAPID_PUBLIC_KEY=your_public_key_here
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_SUBJECT=mailto:your-email@example.com
```

2. **Create PWA icons** (required for install flow):

Create two PNG icon files in `frontend/public/`:
- `icon-192x192.png` (192x192 pixels)
- `icon-512x512.png` (512x512 pixels)

You can use any image editor or online tool. Recommended: a bell icon or your app logo.

3. **Build and start all services**:

```bash
docker-compose up --build
```

The application will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- PostgreSQL: localhost:5432

## Project Structure

```
├── backend/
│   ├── db/              # Database initialization
│   ├── routes/          # API routes (auth, notifications)
│   ├── services/        # Push notification and scheduler services
│   ├── server.js        # Express server
│   └── Dockerfile
├── frontend/
│   ├── public/          # Static assets and service worker
│   ├── index.html       # Main HTML file
│   ├── main.js          # Frontend JavaScript
│   └── Dockerfile
├── docker-compose.yml   # Docker orchestration
└── README.md
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Notifications
- `GET /api/notifications/vapid-public-key` - Get VAPID public key
- `POST /api/notifications/subscribe` - Subscribe to push notifications
- `POST /api/notifications` - Create notification (requires auth)
- `GET /api/notifications` - Get user's notifications (requires auth)
- `PUT /api/notifications/:id` - Update notification (requires auth)
- `DELETE /api/notifications/:id` - Delete notification (requires auth)
- `GET /api/notifications/logs` - Get notification logs (requires auth)

## Usage

1. **Register/Login**: Create an account or login
2. **Enable Notifications**: Grant browser notification permission
3. **Schedule Notification**: Set title, message, and scheduled time
4. **View Logs**: Check notification delivery status
5. **Install PWA**: Click the install button when prompted

## Environment Variables

### Backend
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT tokens
- `VAPID_PUBLIC_KEY` - VAPID public key for push notifications
- `VAPID_PRIVATE_KEY` - VAPID private key for push notifications
- `VAPID_SUBJECT` - VAPID subject (usually email)

### Frontend
- `VITE_API_URL` - Backend API URL

## Development

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Database Schema

- **users**: User accounts (username, email, password_hash)
- **notifications**: Scheduled notifications
- **notification_logs**: Delivery logs
- **push_subscriptions**: User push subscription endpoints

## Notes

- The notification scheduler runs every minute to check for due notifications
- Daily repeat notifications automatically reschedule for the next day
- Push subscriptions are automatically cleaned up if invalid
- All notifications require authentication via JWT tokens

