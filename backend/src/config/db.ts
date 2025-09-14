import mongoose from 'mongoose';
import { loadEnv } from './env.js';

let isConnected = false;

export async function connectMongo(): Promise<typeof mongoose> {
  if (isConnected) return mongoose;
  const { MONGODB_URI } = loadEnv();
  mongoose.set('strictQuery', true);
  await mongoose.connect(MONGODB_URI);
  isConnected = true;
  return mongoose;
}

