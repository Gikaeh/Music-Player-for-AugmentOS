import {startServer} from './server';
import { logEnvironment } from './config/environment';

// Log environment variables
logEnvironment();

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});