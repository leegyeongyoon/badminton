import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler } from './middleware/errorHandler';
import authRouter from './modules/auth/auth.router';
import facilityRouter from './modules/facility/facility.router';
import courtRouter from './modules/court/court.router';
import checkinRouter from './modules/checkin/checkin.router';
import clubRouter from './modules/club/club.router';
import gameRouter from './modules/game/game.router';
import turnRouter from './modules/turn/turn.router';
import userRouter from './modules/user/user.router';
import penaltyRouter from './modules/penalty/penalty.router';
import sessionRouter from './modules/session/session.router';
import notificationRouter from './modules/notification/notification.router';
import clubSessionRouter from './modules/clubSession/clubSession.router';
import gameBoardRouter from './modules/gameBoard/gameBoard.router';
import chatRouter from './modules/chat/chat.router';
import operatorRequestRouter from './modules/operatorRequest/operatorRequest.router';

const app = express();

// Behind a reverse proxy / load balancer (e.g. Nginx, ALB) trust the first
// proxy hop so req.ip reflects the real client IP from X-Forwarded-For. This is
// required for the per-IP rate limiter to key on the actual client.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/facilities', facilityRouter);
app.use('/api/v1/courts', courtRouter);
app.use('/api/v1/courts', turnRouter);  // /courts/:courtId/turns
app.use('/api/v1/turns', turnRouter);   // /turns/:turnId/complete|cancel|requeue|extend
app.use('/api/v1/checkin', checkinRouter);
app.use('/api/v1/checkins', checkinRouter);  // /checkins/:checkInId/fee (guest fee)
app.use('/api/v1/clubs', clubRouter);
app.use('/api/v1/games', gameRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1', penaltyRouter);
app.use('/api/v1', sessionRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/clubs', clubSessionRouter);           // /clubs/:clubId/sessions
app.use('/api/v1/clubs', chatRouter);                  // /clubs/:clubId/messages
app.use('/api/v1/club-sessions', clubSessionRouter);   // /club-sessions/:id/*
app.use('/api/v1/club-sessions', gameBoardRouter);     // /club-sessions/:id/game-board
app.use('/api/v1/game-boards', gameBoardRouter);       // /game-boards/:id/entries/*
app.use('/api/v1/operator-requests', operatorRequestRouter);

app.use(errorHandler);

export default app;
