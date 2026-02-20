import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler } from './middleware/errorHandler';
import authRouter from './modules/auth/auth.router';
import facilityRouter from './modules/facility/facility.router';
import courtRouter from './modules/court/court.router';
import checkinRouter from './modules/checkin/checkin.router';
import clubRouter from './modules/club/club.router';
import holdRouter from './modules/hold/hold.router';
import gameRouter from './modules/game/game.router';
import queueRouter from './modules/queue/queue.router';
import userRouter from './modules/user/user.router';
import penaltyRouter from './modules/penalty/penalty.router';
import sessionRouter from './modules/session/session.router';
import notificationRouter from './modules/notification/notification.router';
import automatchRouter from './modules/automatch/automatch.router';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/facilities', facilityRouter);
app.use('/api/v1/courts', courtRouter);
app.use('/api/v1/checkin', checkinRouter);
app.use('/api/v1/clubs', clubRouter);
app.use('/api/v1/holds', holdRouter);
app.use('/api/v1/games', gameRouter);
app.use('/api/v1/courts', queueRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1', penaltyRouter);
app.use('/api/v1', sessionRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/facilities', automatchRouter);

app.use(errorHandler);

export default app;
