/**
 * Whether a conversation a participant has deleted should be back on screen.
 *
 * Deleting a conversation is one-sided and it is not permanent: it records the
 * moment the participant cleared it, and everything at or before that moment
 * stops being theirs to see. A later message is not covered by that decision,
 * so the thread returns to the inbox carrying only what has arrived since.
 *
 * Three readers need this answered identically — the inbox route, the message
 * route, and the unread badge, which queries `conversations` straight from the
 * browser. A badge counting threads the inbox does not list is a notification
 * the user cannot chase.
 */

export type ConversationDeletionState = {
    buyerId: string;
    sellerId: string;
    buyerDeletedAt: string | null;
    sellerDeletedAt: string | null;
};

/** The viewer's own cut-off, or null if they never deleted this conversation. */
export function ownDeletedAt(conversation: ConversationDeletionState, viewerId: string) {
    return conversation.buyerId === viewerId
        ? conversation.buyerDeletedAt
        : conversation.sellerDeletedAt;
}

/** True while the conversation stays out of this viewer's inbox. */
export function isConversationHidden(
    conversation: ConversationDeletionState,
    viewerId: string,
    lastMessageAt: string | null,
) {
    const deletedAt = ownDeletedAt(conversation, viewerId);
    if (!deletedAt) return false;
    // Nothing has been said since; a conversation with no messages at all was
    // deleted the moment it was empty and has nothing to bring it back.
    if (!lastMessageAt) return true;
    return new Date(lastMessageAt) <= new Date(deletedAt);
}
