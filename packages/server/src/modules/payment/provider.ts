import { randomUUID } from 'crypto';

// ─────────────────────────────────────────────────────────────
// PaymentProvider — PG 추상화. 실 PG(토스페이먼츠/포트원) 연동 시
// MockProvider 대신 실제 구현체를 꽂는다. 서비스 레이어는 이 인터페이스만 안다.
//
//  토스페이먼츠 매핑(연동 시):
//   issueBillingKey → POST /v1/billing/authorizations/card (빌링키 발급)
//   chargeBilling   → POST /v1/billing/{billingKey} (빌링키 결제 승인)
//   cancel          → POST /v1/payments/{paymentKey}/cancel
// ─────────────────────────────────────────────────────────────

export interface CardInput {
  cardNumber: string; // "1234567812345678" (공백/하이픈 허용)
  expiry: string; // "MM/YY"
  birthOrBiz: string; // 생년월일 6자리 또는 사업자번호
}

export interface BillingKeyResult {
  billingKey: string;
  cardBrand: string;
  cardLast4: string;
  cardExpiry: string;
}

export interface ChargeResult {
  txId: string;
}

export class ProviderError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface PaymentProvider {
  readonly name: string;
  issueBillingKey(card: CardInput): Promise<BillingKeyResult>;
  chargeBilling(billingKey: string, amount: number, orderName: string): Promise<ChargeResult>;
  cancel(txId: string): Promise<void>;
}

// 카드 BIN 앞자리로 브랜드 흉내(데모 리얼리티용).
function mockBrand(cardNumber: string): string {
  const d = cardNumber[0];
  if (d === '4') return 'VISA';
  if (d === '5') return 'MASTER';
  if (d === '9') return 'KOOKMIN';
  if (d === '3') return 'SHINHAN';
  return 'LOCAL';
}

/**
 * MockProvider — 실 PG 의 동작(발급 검증·승인 거절·취소)을 시뮬레이션.
 *  · 유효기간이 지난 카드 → 발급 거절
 *  · 카드번호 끝 4자리 "0000" → 발급은 되지만 결제 시 한도 초과 거절
 *    (자동 청구 실패·재결제 flow 를 실제처럼 검증하기 위한 테스트 카드)
 */
export class MockProvider implements PaymentProvider {
  readonly name = 'MOCK';

  async issueBillingKey(card: CardInput): Promise<BillingKeyResult> {
    const num = String(card.cardNumber ?? '').replace(/[\s-]/g, '');
    if (!/^\d{15,16}$/.test(num)) throw new ProviderError('INVALID_CARD', '카드번호가 올바르지 않아요');
    const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(String(card.expiry ?? '').trim());
    if (!m) throw new ProviderError('INVALID_EXPIRY', '유효기간은 MM/YY 형식이에요');
    const expYear = 2000 + Number(m[2]);
    const expMonth = Number(m[1]);
    const now = new Date();
    if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) {
      throw new ProviderError('EXPIRED_CARD', '유효기간이 지난 카드예요');
    }
    if (!/^\d{6}$|^\d{10}$/.test(String(card.birthOrBiz ?? '').trim())) {
      throw new ProviderError('INVALID_OWNER', '생년월일 6자리(또는 사업자번호 10자리)를 입력해 주세요');
    }
    return {
      billingKey: `mock_bk_${randomUUID()}`,
      cardBrand: mockBrand(num),
      cardLast4: num.slice(-4),
      cardExpiry: card.expiry.trim(),
    };
  }

  async chargeBilling(billingKey: string, amount: number, _orderName: string): Promise<ChargeResult> {
    if (!billingKey.startsWith('mock_bk_')) throw new ProviderError('INVALID_BILLING_KEY', '유효하지 않은 결제 수단이에요');
    if (amount <= 0) throw new ProviderError('INVALID_AMOUNT', '결제 금액이 올바르지 않아요');
    // 테스트 카드(끝 0000) 거절 — 빌링키 발급 시 심어둔 마커로 판별.
    if (billingKey.endsWith('_declined')) {
      throw new ProviderError('CARD_DECLINED', '카드 한도 초과로 결제가 거절됐어요');
    }
    return { txId: `mock_tx_${randomUUID()}` };
  }

  async cancel(txId: string): Promise<void> {
    if (!txId.startsWith('mock_tx_')) throw new ProviderError('INVALID_TX', '취소할 수 없는 결제예요');
  }
}

// 끝 4자리 0000 카드는 빌링키에 거절 마커를 붙인다(위 chargeBilling 에서 판별).
export function applyDeclineMarker(result: BillingKeyResult): BillingKeyResult {
  if (result.cardLast4 === '0000') {
    return { ...result, billingKey: `${result.billingKey}_declined` };
  }
  return result;
}

export const provider: PaymentProvider = new MockProvider();
