import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file if it exists (for local development)
// In Docker, env_file in docker-compose.yml already loads variables into process.env
// This dotenv.config() is a fallback for local development
dotenv.config({ path: join(__dirname, '.env') });

// Google OAuth Configuration
export const googleConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
};

// Server Configuration
export const serverConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
};

// Database Configuration
// Build from individual variables (DATABASE_URL is no longer used)
export const dbConfig = {
  host: process.env.POSTGRES_HOST || 'postgres',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'pwa_user',
  password: process.env.POSTGRES_PASSWORD || 'pwa_password',
  database: process.env.POSTGRES_DB || 'pwa_db',
};

// Build DATABASE_URL from individual variables
export function buildDatabaseUrl(): string {
  return `postgresql://${dbConfig.user}:${encodeURIComponent(dbConfig.password)}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;
}

export const DATABASE_URL = buildDatabaseUrl();

// VAPID Configuration for Push Notifications
export const vapidConfig = {
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
  subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
};

// Validate required configuration
export function validateConfig(): void {
  const warnings: string[] = [];

  // Debug: Log environment variable loading (only in development)
  if (serverConfig.nodeEnv === 'development') {
    console.log('🔍 Environment variable check:');
    console.log(`   GOOGLE_CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Not set'}`);
    console.log(`   GOOGLE_CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? '✓ Set' : '✗ Not set'}`);
    console.log(`   DB_HOST: ${process.env.DB_HOST || 'using default'}`);
    console.log(`   PORT: ${process.env.PORT || 'using default'}\n`);
  }

  if (!googleConfig.clientId) {
    warnings.push('GOOGLE_CLIENT_ID is not set - Google OAuth will not work');
  }

  if (!googleConfig.clientSecret) {
    warnings.push('GOOGLE_CLIENT_SECRET is not set - Google OAuth will not work');
  }

  if (!serverConfig.jwtSecret || serverConfig.jwtSecret === 'your-super-secret-jwt-key-change-in-production') {
    warnings.push('Using default JWT_SECRET - Change this in production!');
  }

  // Only show warnings, don't fail startup
  // This allows the server to start in development even without OAuth configured
  if (warnings.length > 0) {
    console.warn('⚠️  Configuration warnings:');
    warnings.forEach(warning => console.warn(`   - ${warning}`));
    console.warn('   Server will start, but some features may not work.\n');
  }
}

// Export all config as a single object for convenience
export const config = {
  google: googleConfig,
  server: serverConfig,
  db: dbConfig,
  vapid: vapidConfig,
};

export default config;

