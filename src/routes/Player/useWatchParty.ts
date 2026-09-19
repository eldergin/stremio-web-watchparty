// Copyright (C) 2017-2026 Smart code 203358507

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type Peer = {
    userName: string,
    contentId: string | null,
};

type WatchPartyStatus = 'idle' | 'connecting' | 'connected' | 'error';

type WatchPartyState = {
    status: WatchPartyStatus,
    serverUrl: string | null,
    roomId: string | null,
    userName: string | null,
    peers: Peer[],
    mismatch: boolean,
    error: string | null,
};

type VideoLike = {
    state: {
        time: number | null,
        paused: boolean | null,
    },
    setTime: (time: number) => void,
    setPaused: (paused: boolean) => void,
};

type IncomingPeerState = {
    time: number,
    paused?: boolean,
    ts: number,
    from: string,
};

// how often we broadcast our position while playing
const HEARTBEAT_INTERVAL = 5000;
// a play/pause change from a peer re-aligns us if we are further apart than this
const STATE_CHANGE_ALIGN_THRESHOLD = 1500;
// heartbeat drift correction: we only ever jump FORWARD to a peer who is this far ahead,
// never back, so nobody gets rolled back and two peers can't ping-pong each other
const HEARTBEAT_CATCHUP_THRESHOLD = 4000;
// after we apply a remote update, ignore our own resulting paused change for this long
// so we don't echo the update we just received back to the room
const REMOTE_APPLY_GUARD_MS = 1000;

const INITIAL_STATE: WatchPartyState = {
    status: 'idle',
    serverUrl: null,
    roomId: null,
    userName: null,
    peers: [],
    mismatch: false,
    error: null,
};

const useWatchParty = (video: VideoLike, contentId: string | null) => {
    const [state, setState] = useState<WatchPartyState>(INITIAL_STATE);

    const socketRef = useRef<Socket | null>(null);
    const videoRef = useRef(video);
    const contentIdRef = useRef(contentId);
    const remoteApplyUntilRef = useRef(0);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    videoRef.current = video;
    contentIdRef.current = contentId;

    const isRemoteApplying = useCallback(() => Date.now() < remoteApplyUntilRef.current, []);

    // Clocks of different machines are never compared: we only use the position the peer
    // reported, not its timestamp.
    const applyRemoteState = useCallback((data: IncomingPeerState) => {
        const v = videoRef.current;
        const isStateMessage = typeof data.paused === 'boolean';

        if (!isStateMessage) {
            // explicit seek from a peer: authoritative
            remoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_GUARD_MS;
            v.setTime(data.time);
            return;
        }

        const localTime = v.state.time;

        if (v.state.paused !== data.paused) {
            // play/pause toggled by a peer
            remoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_GUARD_MS;
            v.setPaused(data.paused as boolean);
            if (localTime === null || Math.abs(data.time - localTime) > STATE_CHANGE_ALIGN_THRESHOLD) {
                v.setTime(data.time);
            }
            return;
        }

        // heartbeat: only catch up to a peer who is well ahead of us
        if (!data.paused && localTime !== null && data.time - localTime > HEARTBEAT_CATCHUP_THRESHOLD) {
            remoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_GUARD_MS;
            v.setTime(data.time);
        }
    }, []);

    const join = useCallback((serverUrl: string, roomId: string, userName: string) => {
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        setState({ ...INITIAL_STATE, status: 'connecting', serverUrl, roomId, userName });

        const socket = io(serverUrl, { transports: ['websocket', 'polling'], forceNew: true });
        socketRef.current = socket;

        socket.on('connect', () => {
            socket.emit('join', { roomId, userName, contentId: contentIdRef.current });
        });

        socket.on('connect_error', (err: Error) => {
            setState((s) => ({ ...s, status: 'error', error: err.message }));
        });

        socket.on('disconnect', () => {
            setState((s) => (s.status === 'idle' ? s : { ...s, status: 'idle' }));
        });

        socket.on('room_info', (data: { users: Peer[] }) => {
            const contentIds = new Set(data.users.map((user) => user.contentId).filter(Boolean));
            setState((s) => ({ ...s, status: 'connected', peers: data.users, error: null, mismatch: contentIds.size > 1 }));
        });

        socket.on('content_mismatch', () => {
            setState((s) => ({ ...s, mismatch: true }));
        });

        socket.on('peer_state', (data: IncomingPeerState) => {
            applyRemoteState(data);
        });
    }, [applyRemoteState]);

    const leave = useCallback(() => {
        if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
        }
        setState(INITIAL_STATE);
    }, []);

    // outgoing: paused/play toggled locally -> tell the room immediately
    useEffect(() => {
        const socket = socketRef.current;
        if (!socket?.connected || isRemoteApplying()) {
            return;
        }
        if (video.state.paused === null || video.state.time === null) {
            return;
        }
        socket.emit('state', { time: Math.round(video.state.time), paused: video.state.paused, ts: Date.now() });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [video.state.paused]);

    // outgoing: the user explicitly seeked -> tell the room. Called from the player's single
    // user-seek entry point, so buffering stalls and remote-applied jumps never get echoed.
    const announceSeek = useCallback((time: number) => {
        const socket = socketRef.current;
        if (socket?.connected) {
            socket.emit('seek', { time: Math.round(time), ts: Date.now() });
        }
    }, []);

    // periodic heartbeat while connected, so drift gets corrected even without an explicit action
    useEffect(() => {
        if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
        }
        if (state.status !== 'connected') {
            return;
        }

        heartbeatRef.current = setInterval(() => {
            const v = videoRef.current;
            const socket = socketRef.current;
            if (!socket?.connected || v.state.time === null || v.state.paused === null || isRemoteApplying()) {
                return;
            }
            socket.emit('state', { time: Math.round(v.state.time), paused: v.state.paused, ts: Date.now() });
        }, HEARTBEAT_INTERVAL);

        return () => {
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
            }
        };
    }, [state.status, isRemoteApplying]);

    useEffect(() => {
        return () => {
            socketRef.current?.disconnect();
        };
    }, []);

    // let a browser extension (if installed) know the current room status,
    // so it can offer quick re-join / room history outside the page itself
    useEffect(() => {
        window.postMessage({
            source: 'stremio-watchparty',
            roomId: state.roomId,
            contentId: contentIdRef.current,
            status: state.status,
            userName: state.userName,
        }, window.location.origin);
    }, [state.status, state.roomId, state.userName]);

    return { state, join, leave, announceSeek };
};

export default useWatchParty;
