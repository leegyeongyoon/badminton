import api from './api';

export const gameApi = {
  createGame: (holdId: string, playerIds: string[]) =>
    api.post(`/holds/${holdId}/games`, { playerIds }),
  getLineup: (holdId: string) =>
    api.get(`/holds/${holdId}/games`),
  call: (gameId: string) =>
    api.post(`/games/${gameId}/call`),
  respond: (gameId: string, accept: boolean) =>
    api.post(`/games/${gameId}/respond`, { accept }),
  start: (gameId: string) =>
    api.post(`/games/${gameId}/start`),
  complete: (gameId: string) =>
    api.post(`/games/${gameId}/complete`),
  replace: (gameId: string, targetPlayerId: string, replacementPlayerId: string) =>
    api.post(`/games/${gameId}/replace`, { targetPlayerId, replacementPlayerId }),
};
