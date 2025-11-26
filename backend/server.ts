import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import notificationRoutes from './routes/notifications.js';
import chatRoutes from './routes/chat.js';
import { db, connectWithRetry } from './db/connection.js';
import { initializeDatabase } from './db/init.js';
import { initializeCronJobs } from './services/scheduler.js';
import { serverConfig, validateConfig } from './app.config.js';

dotenv.config();

// Validate configuration on startup
try {
  validateConfig();
} catch (error) {
  console.error('❌ Configuration validation failed:', error);
  process.exit(1);
}

const app = express();
const PORT = serverConfig.port;

app.use(cors());
app.use(express.json());

// Export db for use in other modules
export { db };

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/chat', chatRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Test connection and initialize database
async function startServer(): Promise<void> {
  try {
    await connectWithRetry();
    await initializeDatabase();
    initializeCronJobs();
    
    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();


