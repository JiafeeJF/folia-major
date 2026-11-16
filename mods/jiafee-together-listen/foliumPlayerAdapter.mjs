import { canonicalSongKey, foliumLoopMode } from './playback-core.mjs?v=1.4.2';
import { QueueSync } from './queue-sync.mjs?v=1.4.2';

// All host access is through the stable Folium playback and Omni services.
// Official 0.7.28 pauses media after a fixed 200ms fade + 15ms timer grace.
// A paused snapshot is not media-ready: also wait for its position to settle.
const PAUSE_SETTLE_MS = 250;
const START_FADE_TOLERANCE_SECONDS = 0.5;

export class FoliumPlayerAdapter {
    constructor(folium, currentRoom) {
        this.host = folium.playback;
        this.currentRoom = currentRoom;
        this.generation = 0;
        this.lastSeek = null;
        this.queue = new QueueSync({ playback: this.host, omni: folium.omni,
            notice: message => folium.ui.toast(message, { type: 'error' }), log: folium.log,
            isCurrent: room => this.currentRoom()?.sessionEpoch === room.sessionEpoch
                && this.currentRoom()?.serverId === room.serverId });
    }
    readState() {
        const state = this.host.getState();
        return { trackId: canonicalSongKey(state.song), position: state.position,
            playing: state.state === 'playing', status: state.state };
    }
    pause() { this.host.pause(); }
    play() { this.host.play(); }
    seek(position) {
        this.lastSeek = { position, until: Date.now() + 1000 };
        this.host.seek(position);
    }
    pauseAtStart() {
        // seekMainAudio resumes playback and cancels pending pause. Pause MUST be last.
        this.seek(0);
        this.pause();
    }
    setMode(mode) {
        const wanted = foliumLoopMode(mode);
        if (mode !== 'shuffle' && this.host.getLoopMode() !== wanted) this.host.setLoopMode(wanted);
    }
    cancelPendingWait() { this.generation++; this.queue.cancel(); }
    async resetSessionPlayback(room) {
        this.pauseAtStart();
        await this.replace({ ...room, queue: [] });
    }
    async replace(room) {
        const generation = this.generation;
        if (await this.queue.request(room)) return;
        for (let attempt = 0; attempt < 200 && this.queue.pending; attempt++) {
            if (generation !== this.generation) throw new Error('FOLIUM_OPERATION_CANCELLED');
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        const actual = this.host.getQueue({ offset: 0, limit: 200 }).items.map(item => canonicalSongKey(item.song));
        if (generation !== this.generation || actual.join('\n') !== room.queue.map(item => item.trackId).join('\n'))
            throw new Error('FOLIUM_QUEUE_SYNC_REFUSED');
    }
    async syncQueue(room) {
        const local = this.host.getQueue({ offset: 0, limit: 200 });
        if (local.items.map(item => canonicalSongKey(item.song)).join('\n') === room.queue.map(item => item.trackId).join('\n')) return;
        await this.replace(room);
    }
    async switchTrack(room) {
        const generation = this.generation;
        const item = this.host.getQueue({ offset: 0, limit: 200 }).items[room.currentIndex];
        if (!item || canonicalSongKey(item.song) !== room.currentTrackId) return false;
        const accepted = await this.host.playQueueItem(item.index, item.song.ref);
        if (generation !== this.generation) return false;
        this.pause();
        return accepted && this.readState().trackId === room.currentTrackId;
    }
    async waitUntilReady(trackId, isCurrent) {
        const generation = this.generation;
        if (!isCurrent() || this.readState().trackId !== trackId) return false;
        this.pauseAtStart();
        const startedAt = Date.now();
        let stableSince = null, stablePosition = null;
        // Folium exposes a playback snapshot, not media canplay readiness. Never claim otherwise.
        for (let attempt = 0; attempt < 40; attempt++) {
            if (generation !== this.generation || !isCurrent()) return false;
            const state = this.readState();
            const now = Date.now();
            const nearStart = state.trackId === trackId && state.status === 'paused'
                && Number.isFinite(state.position) && state.position >= 0
                && state.position <= START_FADE_TOLERANCE_SECONDS;
            if (nearStart && now - startedAt >= PAUSE_SETTLE_MS) {
                if (stablePosition === null || Math.abs(state.position - stablePosition) > 0.01) {
                    stableSince = now;
                    stablePosition = state.position;
                } else if (now - stableSince >= 100) return true;
            } else { stableSince = null; stablePosition = null; }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
    }
    dispose() { this.cancelPendingWait(); this.queue.dispose(); }
}
