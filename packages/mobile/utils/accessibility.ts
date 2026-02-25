/**
 * Accessibility helper functions for generating descriptive labels.
 */

export function courtCardLabel(
  courtName: string,
  status: string,
  gameType: string,
  turnsCount: number,
  maxTurns: number,
  isMyTurn: boolean,
): string {
  const statusText = status === 'EMPTY' ? '비어있음' : status === 'IN_USE' ? '사용 중' : '점검 중';
  const gameTypeText = gameType === 'DOUBLES' ? '복식' : '레슨';
  const turnText = `${turnsCount}/${maxTurns} 순번`;
  const myTurnText = isMyTurn ? ', 내 순번 포함' : '';
  return `${courtName}, ${statusText}, ${gameTypeText}, ${turnText}${myTurnText}`;
}

export function timerLabel(minutes: number, seconds: number): string {
  return `남은 시간 ${minutes}분 ${seconds}초`;
}

export function capacityLabel(
  total: number,
  available: number,
  inTurn: number,
  resting: number,
): string {
  return `전체 ${total}명, 대기 ${available}명, 게임중 ${inTurn}명, 휴식 ${resting}명`;
}

export function playerAvatarLabel(name: string, status?: string): string {
  const statusText = status ? `, ${status}` : '';
  return `${name}${statusText}`;
}
