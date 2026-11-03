import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getToken, WS_URL } from '../api';
import { lang } from '../i18n/index.ts';
import { kanbanKeys } from './api';
import type { BoardDetail, BoardEvent } from './types';

export type LiveState = 'connecting' | 'live' | 'offline';

/**
 * Live updates of one board: after every change the server sends {"type": "board_changed", ...};
 * the board (and the open card) are fetched again. Changes by others are passed to `onOther`
 * (with the card's title, when known) for a small toast. Reconnects after a lost connection
 * and then fetches again, so nothing missed in between stays stale.
 */
export function useBoardSocket(boardId: number, me: string, onOther: (event: BoardEvent, cardTitle: string | null) => void): LiveState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');
  const onOtherRef = useRef(onOther);
  useEffect(() => {
    onOtherRef.current = onOther;
  }, [onOther]);

  useEffect(() => {
    if (!Number.isFinite(boardId) || boardId <= 0) return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let opened = false;

    const refresh = (cardId?: number | null) => {
      void queryClient.invalidateQueries({ queryKey: kanbanKeys.board(boardId) });
      void queryClient.invalidateQueries({ queryKey: ['kanban', 'boards'] });
      if (cardId) void queryClient.invalidateQueries({ queryKey: kanbanKeys.card(cardId) });
    };

    const connect = () => {
      if (stopped) return;
      setState((s) => (s === 'live' ? s : 'connecting'));
      try {
        socket = new WebSocket(`${WS_URL}/ws/kanban/${boardId}`);
      } catch {
        schedule();
        return;
      }
      socket.onopen = () => {
        socket?.send(JSON.stringify({ token: getToken() ?? '', lang: lang() }));
        if (opened) refresh(); // back after a lost connection: catch up
        opened = true;
        retry = 0;
        setState('live');
      };
      socket.onmessage = (msg) => {
        let event: BoardEvent;
        try {
          event = JSON.parse(String(msg.data)) as BoardEvent;
        } catch {
          return;
        }
        if (event.type !== 'board_changed') return;
        const board = queryClient.getQueryData<BoardDetail>(kanbanKeys.board(boardId));
        const title = event.card_id ? (board?.cards.find((c) => c.id === event.card_id)?.title ?? null) : null;
        refresh(event.card_id);
        if (event.by && event.by !== me) onOtherRef.current(event, title);
      };
      socket.onclose = () => {
        socket = null;
        if (stopped) return;
        setState('offline');
        schedule();
      };
      socket.onerror = () => socket?.close();
    };

    const schedule = () => {
      if (stopped) return;
      retry += 1;
      timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** Math.min(retry, 5)));
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [boardId, me, queryClient]);

  return state;
}
