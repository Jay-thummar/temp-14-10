import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { router as rootRouter } from './routes/index.js';

export const app = express();

app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

app.use('/api', rootRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

