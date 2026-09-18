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
    setPlaybackSpeed: (speed: number) => void,
};

type IncomingPeerState = {
    time: number,
    paused?: boolean,
    ts: number,
    from: string,
};

// how often we broadcast our state to peers while playing, so late drift gets corrected
// even without an explicit seek
const HEARTBEAT_INTERVAL = 5000;
// a local time jump bigger than this (beyond what elapsed wall-clock time explains) is
// treated as a manual seek rather than normal playback progression
const SEEK_JUMP_THRESHOLD = 1500;
// remote/local time difference bigger than this snaps to the remote time directly
const HARD_SYNC_THRESHOLD = 3000;
// remote/local time difference smaller than this is considered "in sync", no correction
const SOFT_SYNC_THRESHOLD = 400;
// how much we nudge playbackSpeed to close small gaps without a visible seek
const SOFT_SYNC_SPEED_DELTA = 0.1;
// safety cap so a soft-sync nudge never gets stuck at non-1x speed
const SOFT_SYNC_MAX_DURATION = 8000;
// after we apply a remote update, ignore our own resulting propChanged events for this long
// so we don't immediately echo the update we just received back to the room
const REMOTE_APPLY_GUARD_MS = 400;

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
    const softSyncRef = useRef<{ active: boolean, until: number }>({ active: false, until: 0 });
    const lastLocalTimeRef = useRef<{ time: number | null, ts: number }>({ time: null, ts: Date.now() });
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    videoRef.current = video;
    contentIdRef.current = contentId;

    const isRemoteApplying = useCallback(() => Date.now() < remoteApplyUntilRef.current, []);

    const stopSoftSync = useCallback(() => {
        if (softSyncRef.current.active) {
            softSyncRef.current = { active: false, until: 0 };
            videoRef.current.setPlaybackSpeed(1);
        }
    }, []);

    const applyRemoteState = useCallback((data: IncomingPeerState) => {
        const v = videoRef.current;
        const isStateMessage = typeof data.paused === 'boolean';

        remoteApplyUntilRef.current = Date.now() + REMOTE_APPLY_GUARD_MS;

        if (!isStateMessage) {
            // explicit seek from a peer: authoritative, apply instantly
            stopSoftSync();
            v.setTime(data.time);
            return;
        }

        if (v.state.paused !== data.paused) {
            v.setPaused(data.paused);
        }

        const elapsedSinceSent = data.paused ? 0 : Math.max(0, Date.now() - data.ts);
        const expectedTime = data.time + elapsedSinceSent;
        const localTime = v.state.time ?? expectedTime;
        const diff = expectedTime - localTime;

        if (Math.abs(diff) > HARD_SYNC_THRESHOLD) {
            stopSoftSync();
            v.setTime(expectedTime);
            return;
        }

        if (data.paused || Math.abs(diff) <= SOFT_SYNC_THRESHOLD) {
            stopSoftSync();
            return;
        }

        // small drift: nudge speed briefly instead of a visible seek
        const speed = diff > 0 ? 1 + SOFT_SYNC_SPEED_DELTA : 1 - SOFT_SYNC_SPEED_DELTA;
        softSyncRef.current = { active: true, until: Date.now() + SOFT_SYNC_MAX_DURATION };
        v.setPlaybackSpeed(speed);
    }, [stopSoftSync]);

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
        stopSoftSync();
        setState(INITIAL_STATE);
    }, [stopSoftSync]);

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

    // outgoing: local time jumped more than normal playback would explain -> it's a seek
    useEffect(() => {
        const prev = lastLocalTimeRef.current;
        const now = Date.now();
        const time = video.state.time;

        if (time !== null && prev.time !== null && !isRemoteApplying()) {
            const dTime = time - prev.time;
            const dWall = now - prev.ts;
            if (Math.abs(dTime - dWall) > SEEK_JUMP_THRESHOLD) {
                socketRef.current?.connected && socketRef.current.emit('seek', { time: Math.round(time), ts: now });
            }
        }

        lastLocalTimeRef.current = { time, ts: now };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [video.state.time]);

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

            if (softSyncRef.current.active && Date.now() > softSyncRef.current.until) {
                stopSoftSync();
            }
        }, HEARTBEAT_INTERVAL);

        return () => {
            if (heartbeatRef.current) {
                clearInterval(heartbeatRef.current);
                heartbeatRef.current = null;
            }
        };
    }, [state.status, isRemoteApplying, stopSoftSync]);

    useEffect(() => {
        return () => {
            socketRef.current?.disconnect();
            if (softSyncRef.current.active) {
                videoRef.current.setPlaybackSpeed(1);
            }
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

    return { state, join, leave };
};

export default useWatchParty;
