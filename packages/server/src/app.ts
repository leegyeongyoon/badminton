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
import clientErrorRouter from './modules/clientError/clientError.router';
import adminRouter from './modules/admin/admin.router';
import labRouter from './modules/lab/lab.router';
import guestApplyRouter from './modules/guestApply/guestApply.router';
import guestChatRouter from './modules/guestChat/guestChat.router';
import clubMoneyRouter from './modules/club/clubMoney.router';
import uploadRouter, { UPLOAD_DIR } from './modules/upload/upload.router';
import coachRouter from './modules/coach/coach.router';
import coachChatRouter from './modules/coachChat/coachChat.router';
import coachJobRouter from './modules/coachJob/coachJob.router';
import { noteRequest } from './modules/admin/metrics.service';

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

// 업로드된 이미지 정적 서빙(코치 프로필 사진 등). 파일명이 uuid(불변)라 장기 캐시.
// 웹앱이 API 와 다른 origin 에서 이미지를 임베드하므로 helmet 의 기본
// Cross-Origin-Resource-Policy(same-origin)를 이 경로에서만 cross-origin 으로 완화.
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '7d',
    immutable: true,
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  }),
);

// 트래픽 집계 — health/정적을 제외한 API 요청 수를 하루 단위로 카운트(슈퍼관리자 대시보드).
// 가벼운 카운터만 증가(동기, DB 접근 없음). 실제 저장은 metrics 서비스가 주기적으로 flush.
app.use('/api/v1', (req, _res, next) => {
  if (req.path !== '/health') noteRequest();
  next();
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/facilities', facilityRouter);
app.use('/api/v1/courts', courtRouter);
app.use('/api/v1/courts', turnRouter);  // /courts/:courtId/turns
app.use('/api/v1/turns', turnRouter);   // /turns/:turnId/complete|cancel|requeue|extend
app.use('/api/v1/checkin', checkinRouter);
app.use('/api/v1/checkins', checkinRouter);  // /checkins/:checkInId/fee (guest fee)
app.use('/api/v1/clubs', clubRouter);
app.use('/api/v1/clubs', clubMoneyRouter);             // /clubs/:id/money/* (모임 회비 관리 — LEADER/STAFF)
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
app.use('/api/v1/admin', adminRouter);                 // /admin/metrics (슈퍼관리자)
app.use('/api/v1/lab', labRouter);                     // /lab/* (실험실 — 최고관리자 전용 상용 프로토타입)
app.use('/api/v1/guest-apply', guestApplyRouter);      // 게스트 사전 신청(공개, rate-limit)
app.use('/api/v1/guest-chat', guestChatRouter);        // 게스트 문의 채팅(공개, rate-limit)
app.use('/api/v1/uploads', uploadRouter);              // 이미지 업로드(인증, rate-limit)
app.use('/api/v1/coaches', coachRouter);               // 코치 마켓(목록/상세 공개, me/인증 관리)
app.use('/api/v1/coach-chat', coachChatRouter);        // 코치 문의 채팅(인증)
app.use('/api/v1/coach-jobs', coachJobRouter);         // 코치 구인 공고 + 지원 관리(원티드식)
// Client crash/error sink. Use a tight body limit so a runtime error report
// (message + stack) can't carry an oversized payload. Mounted before the
// errorHandler. The global express.json() above already parsed the body; the
// extra parser just enforces the smaller cap for this route's content.
app.use('/api/v1', express.json({ limit: '32kb' }), clientErrorRouter);

app.use(errorHandler);

export default app;
