import pkg from 'pg';
const { Pool } = pkg;
import type { Pool as PoolType } from 'pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://pwa_user:pwa_password@postgres:5432/pwa_db';

// Create connection pool with retry logic
export const db: PoolType = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Handle pool errors
db.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Test connection with retry
export async function connectWithRetry(maxRetries: number = 10, delay: number = 2000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await db.query('SELECT NOW(), current_database(), current_user');
      const row = result.rows[0];
      console.log('✅ Connected to PostgreSQL');
      console.log(`   Database: ${row.current_database}`);
      console.log(`   User: ${row.current_user}`);
      console.log(`   Time: ${row.now}`);
      return true;
    } catch (error) {
      const err = error as Error;
      console.error(`Connection attempt ${i + 1}/${maxRetries} failed:`, err.message);
      if (i < maxRetries - 1) {
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('❌ Failed to connect to PostgreSQL after all retries');
        throw error;
      }
    }
  }
  return false;
}


