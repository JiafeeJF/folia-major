let activeCommandId: string | null = null;

/** Marks synchronous store writes caused by one public playback command. */
export const withPlaybackCommand = <T>(commandId: string, work: () => T): T => {
    const previous = activeCommandId;
    activeCommandId = commandId;
    try {
        return work();
    } finally {
        activeCommandId = previous;
    }
};

export const currentPlaybackCommandId = (): string | null => activeCommandId;
