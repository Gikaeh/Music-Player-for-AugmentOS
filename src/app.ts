import express from 'express';
import {authRoutes} from './controllers/auth-controller';

export function createExpressApp() {
  const app = express();
  
  // Add authentication routes
  app.use('/', authRoutes);
  
  return app;
}