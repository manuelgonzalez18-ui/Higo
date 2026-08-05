export const getRideMessageKey = (message = {}) => message.id != null
    ? String(message.id)
    : `${message.sender_id || ''}:${message.created_at || ''}:${message.content || ''}`;

export const isRideMessageAtOrAfter = (message, cutoffIso) => {
    const createdAt = new Date(message?.created_at || 0).getTime();
    const cutoff = new Date(cutoffIso || 0).getTime();
    return Number.isFinite(createdAt)
        && Number.isFinite(cutoff)
        && createdAt >= cutoff;
};
