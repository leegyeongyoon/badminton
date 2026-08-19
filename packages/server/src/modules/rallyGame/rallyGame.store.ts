/**
 * 콕고 랠리 PvP — 인메모리 매치 레지스트리.
 * 서버는 게임 로직 없이 방 관리·릴레이만 한다. 단일 인스턴스 전제(파이/EC2)라
 * 인메모리로 충분하며 재시작 시 소실은 허용(진행 중 대결은 클라가 이탈 처리).
 * 소켓 레이어와 서비스 양쪽에서 쓰므로 이 파일은 다른 모듈을 import하지 않는다(순환 방지).
 */

export interface RallyMatch {
  id: string;
  clubSessionId: string;
  hostId: string;
  hostName: string;
  guestId: string;
  state: 'PENDING' | 'ACTIVE';
  createdAt: number;
}

const matches = new Map<string, RallyMatch>();

export function putRallyMatch(match: RallyMatch): void {
  matches.set(match.id, match);
}

export function getRallyMatch(id: string): RallyMatch | undefined {
  return matches.get(id);
}

export function deleteRallyMatch(id: string): void {
  matches.delete(id);
}

/** 유저가 걸려 있는 PENDING/ACTIVE 매치 — 중복 신청 가드용 */
export function findRallyMatchByUser(userId: string): RallyMatch | undefined {
  for (const m of matches.values()) {
    if (m.hostId === userId || m.guestId === userId) return m;
  }
  return undefined;
}

export function isRallyMember(matchId: string, userId: string): boolean {
  const m = matches.get(matchId);
  return !!m && (m.hostId === userId || m.guestId === userId);
}
