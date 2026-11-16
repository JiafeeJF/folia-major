import { PlaybackController } from './vendorPlaybackCore.mjs?v=1.4.2';
import { FoliumPlayerAdapter } from './foliumPlayerAdapter.mjs?v=1.4.2';
import { canonicalSongKey, serializeTrack, protocolMode } from './playback-core.mjs?v=1.4.2';
import { queueEdits } from './queue-sync.mjs?v=1.4.2';

// Latest Mineradio authority controller, with Folium events converted to local intents here only.
export class PlaybackSession {
    constructor(folium, send, report) {
        this.folium = folium;
        this.room = null;
        this.pendingTrack = '';
        this.localExecution = Promise.resolve();
        this.stateIntentVersion = 0;
        this.stateIntentCount = 0;
        this.adapter = new FoliumPlayerAdapter(folium, () => this.room);
        this.core = new PlaybackController({ adapter: this.adapter, send, onError: report,
            hasPendingLocalIntent: () => this.stateIntentCount > 0 || !!this.pendingTrack });
        this.send = send;
        this.timer = null;
    }
    accept(event, connected, clientId) {
        if (this.room && event.state?.serverId === this.room.serverId
            && event.state?.sessionEpoch === this.room.sessionEpoch
            && event.state.version < this.room.version) return Promise.resolve();
        this.room = event.state;
        const members = this.room?.members || [];
        const paired = connected && new Set(members.map(member => member.senderId)).size === 2;
        this.core.setConnection(paired, clientId);
        if (paired && !this.timer) this.timer = setInterval(() => this.core.correctProgress(this.room), 1000);
        if (!paired) { clearInterval(this.timer); this.timer = null; return Promise.resolve(); }
        if (this.pendingTrack && this.room.currentTrackId === this.pendingTrack && this.room.transition) this.pendingTrack = '';
        if (this.pendingTrack) return Promise.resolve();
        return this.core.acceptAuthority(event);
    }
    song(song) {
        this.localExecution = this.localExecution.then(async () => {
            const track = serializeTrack(song);
            if (!this.core.connected || !track || this.pendingTrack === track.trackId) return;
            if (!this.room.currentTrackId && !this.folium.playback.getQueue({ offset: 0, limit: 1 }).length) return;
            if (canonicalSongKey(this.folium.playback.getState().song) !== track.trackId || this.room?.currentTrackId === track.trackId) return;
            this.pendingTrack = track.trackId;
            const clientId = this.core.clientId;
            this.core.setConnection(false);
            this.core.setConnection(true, clientId);
            this.adapter.pauseAtStart();
            try {
                if (!this.room.currentTrackId) {
                    await this.core.request('RESYNC', { snapshot: { queue: [track], currentIndex: 0,
                        position: 0, playing: false, mode: protocolMode(this.folium.playback.getLoopMode()) } });
                } else if (!this.room.queue.some(item => item.trackId === track.trackId)) {
                    await this.core.request('QUEUE_ADD', { track, index: this.room.queue.length });
                }
                await this.core.dispatchLocal('NEXT', { targetTrackId: track.trackId, playing: true });
            } catch (error) { this.pendingTrack = ''; throw error; }
        });
        const result = this.localExecution;
        this.localExecution = result.catch(() => {});
        return result;
    }
    canPublish() {
        return this.core.connected && !this.core.executing && !this.pendingTrack
            && this.adapter.readState().trackId === this.room?.currentTrackId
            && this.room?.currentTrackId && !['preparing', 'awaiting-end'].includes(this.room.transition?.phase);
    }
    async state(value) {
        const intent = ++this.stateIntentVersion;
        const epoch = this.core.connectionEpoch;
        const actual = this.folium.playback.getState();
        if (!this.core.connected || this.pendingTrack || !this.room?.currentTrackId
            || ['preparing', 'awaiting-end'].includes(this.room.transition?.phase)
            || value !== actual.state || canonicalSongKey(actual.song) !== this.room.currentTrackId) return;
        if ((value === 'playing') === this.room.playing || value === 'stopped') return;
        // Folium notifications can arrive while an unrelated authority task is awaiting the host.
        // Keep the intent, then recheck it; never drop it solely because the controller is busy.
        this.stateIntentCount++;
        try {
            await this.core.whenIdle();
            const current = this.folium.playback.getState();
            if (intent !== this.stateIntentVersion || epoch !== this.core.connectionEpoch
                || !this.canPublish() || current.state !== value
                || canonicalSongKey(current.song) !== canonicalSongKey(actual.song)
                || (value === 'playing') === this.room.playing) return;
            return await this.core.dispatchLocal(value === 'playing' ? 'PLAY' : 'PAUSE',
                { trackId: this.room.currentTrackId, position: current.position });
        } finally { this.stateIntentCount--; }
    }
    seek(position) {
        if (!this.canPublish()) return;
        const own = this.adapter.lastSeek;
        if (own && own.until > Date.now() && Math.abs(own.position - position) < 0.2) { this.adapter.lastSeek = null; return; }
        if (this.adapter.readState().trackId !== this.room.currentTrackId) return;
        return this.core.dispatchLocal('SEEK', { trackId: this.room.currentTrackId, position });
    }
    async queueChanged(event) {
        const changed = await this.adapter.queue.queueChanged(event);
        if (!this.canPublish() || !changed) return;
        const local = this.folium.playback.getQueue({ offset: 0, limit: 200 }).items.map(item => serializeTrack(item.song)).filter(Boolean);
        for (const edit of queueEdits(this.room.queue, local)) await this.core.request(edit.type, edit.payload);
    }
    disconnect(final = false) {
        this.stateIntentVersion++;
        this.core.setConnection(false);
        this.adapter.cancelPendingWait();
        this.pendingTrack = '';
        clearInterval(this.timer); this.timer = null;
        if (final) { this.core.resetSessionIdentity(); this.room = null; }
    }
    dispose() { this.disconnect(true); this.adapter.dispose(); }
}
