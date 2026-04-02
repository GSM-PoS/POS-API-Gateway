// Load environment variables explicitly for PM2 compatibility
import { config as dotenvConfig } from 'dotenv';
import path from 'path';

// Load .env file explicitly
const envPath = path.resolve(process.cwd(), '.env');
dotenvConfig({ path: envPath });

// Import the main app after environment variables are loaded
import('./index.ts');