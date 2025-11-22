import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import notificationRoutes from './routes/notifications.js';
import { db, connectWithRetry } from './db/connection.js';
import { initializeDatabase } from './db/init.js';
import { initializeCronJobs } from './services/scheduler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Export db for use in other modules
export { db };

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Test connection and initialize database
async function startServer() {
  try {
    await connectWithRetry();
    await initializeDatabase();
    initializeCronJobs();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

