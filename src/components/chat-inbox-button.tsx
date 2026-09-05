'use client';
import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSupabase, useUser } from '@/lib/supabase';

const ChatDrawer = dynamic(() => import('./chat-drawer').then(m => m.ChatDrawer), { ssr: false });

export function ChatInboxButton() {
    const supabase = useSupabase();
    const { user } = useUser();
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => { if (open) setLoaded(true); }, [open]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [requestedConversationId, setRequestedConversationId] = useState<string | null>(null);
    // The server renders this signed out — the auth provider only finds the
    // session cookie in the browser — so `disabled` differs between the server
    // HTML and the client's first render. React leaves an attribute mismatch on
    // a hydrated element alone, which left the button permanently unclickable.
    // Match the server on the first pass and enable it on the update after.
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        setHydrated(true);
    }, []);

    // Allow any part of the app (e.g. a notification click) to open the inbox
    // on a specific conversation via a window event.
    useEffect(() => {
        const handleOpenChat = (event: Event) => {
            const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
            setRequestedConversationId(detail?.conversationId || null);
            setOpen(true);
        };
        window.addEventListener('cardverse:open-chat', handleOpenChat);
        return () => window.removeEventListener('cardverse:open-chat', handleOpenChat);
    }, []);

    const fetchUnreadCount = useCallback(async () => {
        if (!user) {
            setUnreadCount(0);
            return;
        }

        const { data } = await supabase
            .from("conversations")
            .select("buyer_id, seller_id, last_message_at, buyer_last_read_at, seller_last_read_at")
            .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);

        const count = (data || []).filter((conversation: any) => {
            if (!conversation.last_message_at) return false;
            const ownReadAt = conversation.buyer_id === user.id
                ? conversation.buyer_last_read_at
                : conversation.seller_last_read_at;
            return !ownReadAt || new Date(conversation.last_message_at) > new Date(ownReadAt);
        }).length;
        setUnreadCount(count);
    }, [supabase, user]);

    useEffect(() => {
        void fetchUnreadCount();
    }, [fetchUnreadCount]);

    useEffect(() => {
        const handleChatUpdated = () => void fetchUnreadCount();
        window.addEventListener("cardverse:chat-updated", handleChatUpdated);
        return () => window.removeEventListener("cardverse:chat-updated", handleChatUpdated);
    }, [fetchUnreadCount]);

    useEffect(() => {
        if (!user) return;
        const channel = supabase
            .channel(`chat-inbox-count-${user.id}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "conversations", filter: `buyer_id=eq.${user.id}` },
                () => void fetchUnreadCount(),
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "conversations", filter: `seller_id=eq.${user.id}` },
                () => void fetchUnreadCount(),
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchUnreadCount, supabase, user]);

    return (
        <>
            <Button variant="ghost" size="icon" className="relative" onClick={() => setOpen(true)} disabled={!user || !hydrated}>
                <MessageCircle className="h-4 w-4" />
                {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
                        {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                )}
            </Button>
            {(open || loaded) && <ChatDrawer open={open} onOpenChange={setOpen} initialConversationId={requestedConversationId} />}
        </>
    );
}
