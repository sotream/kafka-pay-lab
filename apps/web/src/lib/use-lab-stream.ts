'use client';

import { useEffect, useReducer } from 'react';
import { initialState, reduce } from './lab-reducer';
import type { LabState } from './lab-reducer';
import type { StreamEvent } from './lab-types';

/** Subscribes to the API's SSE stream; EventSource reconnects by itself, and the next snapshot resyncs us. */
export function useLabStream(url: string): LabState {
  const [state, dispatch] = useReducer(reduce, initialState);

  useEffect(() => {
    const source = new EventSource(url);
    source.onerror = () => dispatch({ type: 'connection', connection: 'reconnecting' });
    source.onmessage = (message: MessageEvent<string>) => {
      dispatch(JSON.parse(message.data) as StreamEvent);
    };
    return () => source.close();
  }, [url]);

  return state;
}
