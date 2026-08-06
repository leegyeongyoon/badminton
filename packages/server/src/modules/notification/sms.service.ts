import crypto from 'crypto';
import { logger } from '../../utils/logger';

/**
 * 솔라피(Solapi) SMS 발송 — 외부 SDK 없이 REST + HMAC-SHA256 인증으로 직접 호출한다.
 *
 * 환경변수 3개가 '모두' 있을 때만 실제로 보낸다. 하나라도 없으면 조용히 스킵(로그만)하므로
 * 로컬·미연동 환경에서 안전하다(부팅/역할변경 등 상위 로직을 절대 막지 않음).
 *   - SOLAPI_API_KEY     : 솔라피 콘솔 > API Key
 *   - SOLAPI_API_SECRET  : 솔라피 콘솔 > API Secret
 *   - SOLAPI_SENDER      : 솔라피에 '사전등록'된 발신번호 (하이픈 제거해서 보관)
 */
const API_KEY = process.env.SOLAPI_API_KEY;
const API_SECRET = process.env.SOLAPI_API_SECRET;
const SENDER = (process.env.SOLAPI_SENDER || '').replace(/[^0-9]/g, '');
const SOLAPI_SEND_URL = 'https://api.solapi.com/messages/v4/send';

export function isSmsEnabled(): boolean {
  return !!(API_KEY && API_SECRET && SENDER);
}

/**
 * 솔라피 HMAC 인증 헤더 생성.
 * signature = HMAC-SHA256(apiSecret, date + salt) (hex).
 */
function buildAuthHeader(): string {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString('hex'); // 12~64자 요구 → 64자
  const signature = crypto
    .createHmac('sha256', API_SECRET as string)
    .update(date + salt)
    .digest('hex');
  return `HMAC-SHA256 apiKey=${API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

/**
 * 단건 문자 발송. 한글 45자(90byte) 초과 시 솔라피가 자동으로 LMS(장문)로 전환한다.
 *
 * 실패해도 예외를 던지지 않고 false 를 반환한다 — 호출부(운영진 승급 등)의 본 로직은
 * 문자 성공 여부와 무관하게 계속 진행돼야 하기 때문이다.
 */
export async function sendSms(to: string, text: string): Promise<boolean> {
  if (!isSmsEnabled()) {
    logger.info('sendSms 스킵 — SOLAPI 미설정(API_KEY/SECRET/SENDER)');
    return false;
  }
  const normalizedTo = (to || '').replace(/[^0-9]/g, '');
  if (!normalizedTo) {
    logger.warn('sendSms 스킵 — 수신번호 없음/형식오류');
    return false;
  }

  try {
    const res = await fetch(SOLAPI_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: buildAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: { to: normalizedTo, from: SENDER, text } }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      logger.error('sendSms 실패(HTTP)', { status: res.status, body: errBody.slice(0, 500) });
      return false;
    }

    const json: any = await res.json().catch(() => ({}));
    // 접수 성공 코드는 2000 계열. 그 외(발신번호 미등록·잔액부족 등)는 실패로 남긴다.
    const code = String(json?.statusCode ?? '');
    if (code && !code.startsWith('2') && !code.startsWith('3')) {
      logger.error('sendSms 접수 거부', { statusCode: code, statusMessage: json?.statusMessage });
      return false;
    }
    logger.info('sendSms 성공', { to: normalizedTo, messageId: json?.messageId, statusCode: code });
    return true;
  } catch (err) {
    logger.error('sendSms 예외', { err });
    return false;
  }
}
