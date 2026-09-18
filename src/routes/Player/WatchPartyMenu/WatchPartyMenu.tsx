// Copyright (C) 2017-2026 Smart code 203358507

import React, { useCallback, useState } from 'react';
import classNames from 'classnames';
import { Button, TextInput } from 'stremio/components';
import { randomPokemonRoomName } from './pokemonRoomNames';
import styles from './styles.less';

type Peer = {
    userName: string,
    contentId: string | null,
};

type Props = {
    className?: string,
    status: 'idle' | 'connecting' | 'connected' | 'error',
    roomId: string | null,
    userName: string | null,
    peers: Peer[],
    mismatch: boolean,
    error: string | null,
    contentId: string | null,
    onJoin: (serverUrl: string, roomId: string, userName: string) => void,
    onLeave: () => void,
};

const DEFAULT_SERVER_URL = 'https://weights-decisions-boxing-litigation.trycloudflare.com';

const WatchPartyMenu = React.forwardRef<HTMLDivElement, Props>(({
    className, status, roomId, userName, peers, mismatch, error, contentId, onJoin, onLeave,
}, ref) => {
    const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
    const [roomInput, setRoomInput] = useState(randomPokemonRoomName);
    const [nameInput, setNameInput] = useState('');

    const onMouseDown = useCallback((event: React.MouseEvent) => {
        (event.nativeEvent as unknown as { watchPartyMenuClosePrevented?: boolean }).watchPartyMenuClosePrevented = true;
    }, []);

    const onJoinClick = useCallback(() => {
        if (roomInput.trim().length === 0 || nameInput.trim().length === 0) {
            return;
        }
        onJoin(serverUrl.trim(), roomInput.trim(), nameInput.trim());
    }, [serverUrl, roomInput, nameInput, onJoin]);

    const connected = status === 'connected';

    return (
        <div ref={ref} className={classNames(className, styles['watch-party-menu'])} onMouseDown={onMouseDown}>
            <div className={styles['title']}>Watch Party</div>

            {
                !connected ?
                    <div className={styles['join-form']}>
                        <label className={styles['label']}>Room code</label>
                        <div className={styles['hint']}>Share this to invite, or type someone else's to join them</div>
                        <TextInput
                            className={styles['input']}
                            value={roomInput}
                            onChange={(e) => setRoomInput(e.target.value)}
                            onSubmit={onJoinClick}
                        />
                        <label className={styles['label']}>Your name</label>
                        <TextInput
                            className={styles['input']}
                            value={nameInput}
                            placeholder={'e.g. alice'}
                            onChange={(e) => setNameInput(e.target.value)}
                            onSubmit={onJoinClick}
                        />
                        <label className={styles['label']}>Sync server URL</label>
                        <TextInput
                            className={styles['input']}
                            value={serverUrl}
                            onChange={(e) => setServerUrl(e.target.value)}
                            onSubmit={onJoinClick}
                        />
                        <Button className={styles['join-button']} title={'Join'} onClick={onJoinClick}>
                            <div className={styles['join-button-label']}>
                                { status === 'connecting' ? 'Connecting…' : 'Join' }
                            </div>
                        </Button>
                        {
                            status === 'error' && error ?
                                <div className={styles['error']}>{ error }</div>
                                :
                                null
                        }
                    </div>
                    :
                    <div className={styles['room-view']}>
                        <div className={styles['room-id']}>Room: { roomId }</div>
                        {
                            mismatch ?
                                <div className={styles['mismatch-warning']}>
                                    Some people in this room are watching a different file.
                                </div>
                                :
                                null
                        }
                        <div className={styles['peers']}>
                            {
                                peers.map((peer) => (
                                    <div key={peer.userName} className={styles['peer']}>
                                        <div className={styles['peer-name']}>
                                            { peer.userName }{ peer.userName === userName ? ' (you)' : '' }
                                        </div>
                                        <div className={classNames(styles['peer-dot'], { [styles['peer-dot-mismatch']]: peer.contentId !== contentId })} />
                                    </div>
                                ))
                            }
                        </div>
                        <Button className={styles['leave-button']} title={'Leave'} onClick={onLeave}>
                            <div className={styles['leave-button-label']}>Leave room</div>
                        </Button>
                    </div>
            }
        </div>
    );
});

export default WatchPartyMenu;
