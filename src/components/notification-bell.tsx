"use client";

import { useEffect, useState, useRef } from "react";
import { useSupabase, useUser } from "@/lib/supabase";
import type { Notification } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, CheckCircle, MessageCircle, Tag, Package } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS, ja, vi } from "date-fns/locale";
import { useRouter } from "next/navigation";
import { useLocalization } from "@/context/localization-context";

export function NotificationBell() {
    const supabase = useSupabase();
    const { user } = useUser();
    const router = useRouter();
    const { locale } = useLocalization();
    const copy = locale === 'ja-JP'
        ? {
            title: '通知',
            markAllRead: 'すべて既読にする',
            enableBrowser: 'ブラウザ通知を有効にする',
            browserBlocked: 'ブラウザ通知がブロックされています。ブラウザの設定で有効にしてください。',
            empty: '通知はありません',
            unreadTitle: '新しい通知が{count}件あります',
        }
        : locale === 'vi-VN'
            ? {
                title: 'Thông báo',
                markAllRead: 'Đánh dấu đã đọc',
                enableBrowser: 'Bật thông báo trên trình duyệt',
                browserBlocked: 'Thông báo trình duyệt đang bị chặn. Hãy bật lại trong cài đặt của trình duyệt.',
                empty: 'Không có thông báo',
                unreadTitle: 'Có ({count}) thông báo mới',
            }
            : {
                title: 'Notifications',
                markAllRead: 'Mark all as read',
                enableBrowser: 'Enable browser notifications',
                browserBlocked: 'Browser notifications are blocked. Enable them in your browser settings.',
                empty: 'No notifications',
                unreadTitle: '{count} new notification(s)',
            };
    const distanceLocale = locale === 'ja-JP' ? ja : locale === 'vi-VN' ? vi : enUS;
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [previousUnreadCount, setPreviousUnreadCount] = useState(0);
    const [isRinging, setIsRinging] = useState(false);
    const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');

    // Pre-load audio for better playback
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioUnlockedRef = useRef(false);
    const browserPermissionRef = useRef<NotificationPermission | 'unsupported'>('unsupported');
    const mutedConversationIdsRef = useRef<Set<string>>(new Set());
    const originalTitleRef = useRef<string | null>(null);
    useEffect(() => {
        const audio = new Audio('/assets/notify.wav');
        audio.preload = 'auto';
        audio.volume = 0.5;
        audio.load();
        audioRef.current = audio;

        // Chrome/Safari block media started from a background realtime event
        // until this document has played media during a user gesture. Unlock
        // the notification element silently on the first interaction so later
        // incoming messages can play even while the tab is in the background.
        let disposed = false;
        const removeUnlockListeners = () => {
            document.removeEventListener('pointerdown', unlockAudio, true);
            document.removeEventListener('keydown', unlockAudio, true);
        };
        const unlockAudio = () => {
            if (audioUnlockedRef.current) {
                removeUnlockListeners();
                return;
            }

            const previousVolume = audio.volume;
            audio.volume = 0;
            void audio.play()
                .then(() => {
                    audio.pause();
                    audio.currentTime = 0;
                    audio.volume = previousVolume;
                    if (disposed) return;
                    audioUnlockedRef.current = true;
                    removeUnlockListeners();
                })
                .catch((error) => {
                    audio.volume = previousVolume;
                    console.warn('Could not unlock notification sound:', error);
                });
        };

        document.addEventListener('pointerdown', unlockAudio, true);
        document.addEventListener('keydown', unlockAudio, true);

        const permission = 'Notification' in window ? window.Notification.permission : 'unsupported';
        browserPermissionRef.current = permission;
        setBrowserPermission(permission);

        return () => {
            disposed = true;
            removeUnlockListeners();
            audio.pause();
            audioRef.current = null;
        };
    }, []);

    useEffect(() => {
        const handleConversationMuted = (event: Event) => {
            const detail = (event as CustomEvent<{ conversationId?: string; muted?: boolean }>).detail;
            if (!detail?.conversationId || typeof detail.muted !== 'boolean') return;
            const next = new Set(mutedConversationIdsRef.current);
            if (detail.muted) next.add(detail.conversationId);
            else next.delete(detail.conversationId);
            mutedConversationIdsRef.current = next;
        };
        window.addEventListener('cardverse:conversation-muted', handleConversationMuted);
        return () => window.removeEventListener('cardverse:conversation-muted', handleConversationMuted);
    }, []);

    const requestBrowserNotifications = async () => {
        if (!('Notification' in window)) return;
        const permission = await window.Notification.requestPermission();
        browserPermissionRef.current = permission;
        setBrowserPermission(permission);
    };

    // Fetch and subscribe to notifications for current user
    useEffect(() => {
        if (!user) return;
        const uid = user.id;

        const fetchMutedConversationIds = async () => {
            const { data, error } = await supabase
                .from('conversation_notification_preferences')
                .select('conversation_id')
                .eq('user_id', uid)
                .eq('muted', true);

            if (error) {
                console.error('Error fetching muted conversations:', error);
                return;
            }
            const preferences = (data || []) as Array<{ conversation_id: string }>;
            mutedConversationIdsRef.current = new Set(preferences.map(preference => preference.conversation_id));
        };

        // Initial fetch
        const fetchNotifications = async () => {
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', uid)
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) {
                console.error('Error fetching notifications:', error);
                return;
            }

            const notificationsData = ((data || []) as any[]).map(n => ({
                id: n.id,
                userId: n.user_id,
                type: n.type as Notification['type'],
                title: n.title,
                message: n.message,
                cardId: n.card_id,
                offerId: n.offer_id,
                conversationId: n.conversation_id,
                transactionId: n.transaction_id,
                read: n.read,
                createdAt: n.created_at,
            }));

            setNotifications(notificationsData);
            setPreviousUnreadCount(notificationsData.filter(n => !n.read).length);
        };

        void fetchNotifications();
        const mutedPreferencesPromise = fetchMutedConversationIds();

        // Subscribe to realtime updates
        const channel = supabase
            .channel(`notifications-${uid}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${uid}`,
                },
                async (payload) => {
                    const newNotification = {
                        id: payload.new.id,
                        userId: payload.new.user_id,
                        type: payload.new.type as Notification['type'],
                        title: payload.new.title,
                        message: payload.new.message,
                        cardId: payload.new.card_id,
                        offerId: payload.new.offer_id,
                        conversationId: payload.new.conversation_id,
                        transactionId: payload.new.transaction_id,
                        read: payload.new.read,
                        createdAt: payload.new.created_at,
                    };

                    setNotifications(prev => [newNotification, ...prev]);
                    await mutedPreferencesPromise;

                    const isMutedMessage = newNotification.type === 'message_received'
                        && !!newNotification.conversationId
                        && mutedConversationIdsRef.current.has(newNotification.conversationId);

                    if (!isMutedMessage) {
                        // Play pre-loaded notification sound
                        if (audioRef.current) {
                            audioRef.current.currentTime = 0;
                            audioRef.current.volume = 0.5;
                            audioRef.current.play().catch(error => {
                                console.warn('Could not play notification sound:', error);
                            });
                        }

                        // Update browser tab title
                        document.title = copy.unreadTitle.replace('{count}', '1');

                        // Trigger bell ringing animation
                        setIsRinging(true);
                        setTimeout(() => setIsRinging(false), 3000);

                        // A browser notification complements the in-app unread state
                        // while CardVerse is open in a background tab.
                        if (browserPermissionRef.current === 'granted' && document.hidden) {
                            const browserNotification = new window.Notification(newNotification.title, {
                                body: newNotification.message,
                                icon: '/assets/brow-logo.png',
                                tag: newNotification.conversationId
                                    ? `cardverse-chat-${newNotification.conversationId}`
                                    : `cardverse-notification-${newNotification.id}`,
                            });
                            browserNotification.onclick = () => {
                                window.focus();
                                browserNotification.close();
                                void supabase
                                    .from('notifications')
                                    .update({ read: true } as never)
                                    .eq('id', newNotification.id);
                                setNotifications(current => current.map(notification =>
                                    notification.id === newNotification.id ? { ...notification, read: true } : notification,
                                ));

                                if (newNotification.type === 'offer_accepted' && newNotification.offerId) {
                                    window.location.assign(`/checkout?offerId=${newNotification.offerId}`);
                                } else if (newNotification.type === 'offer_accepted' && newNotification.transactionId) {
                                    window.location.assign(`/transaction/${newNotification.transactionId}`);
                                } else if (newNotification.conversationId) {
                                    window.dispatchEvent(new CustomEvent('cardverse:open-chat', {
                                        detail: { conversationId: newNotification.conversationId },
                                    }));
                                } else if (newNotification.cardId) {
                                    window.location.assign(`/cards/${newNotification.cardId}`);
                                }
                            };
                        }
                    }
                },
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'conversation_notification_preferences',
                    filter: `user_id=eq.${uid}`,
                },
                () => void fetchMutedConversationIds(),
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]); // Use user.id string — not user object

    // Mark notification as read
    const markAsRead = async (notificationId: string) => {
        try {
            await supabase
                .from('notifications')
                .update({ read: true } as never)
                .eq('id', notificationId);

            setNotifications(prev =>
                prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
            );
        } catch (error) {
            console.error("Error marking notification as read:", error);
        }
    };

    // Handle notification click — route into the most specific context we have.
    const handleNotificationClick = async (notification: Notification) => {
        await markAsRead(notification.id);
        setIsOpen(false);

        // Accepted offer → go straight to checkout. Legacy notifications may
        // still carry a transaction id, so keep that fallback alive.
        if (notification.type === 'offer_accepted' && notification.offerId) {
            router.push(`/checkout?offerId=${notification.offerId}`);
            return;
        }

        if (notification.type === 'offer_accepted' && notification.transactionId) {
            router.push(`/transaction/${notification.transactionId}`);
            return;
        }

        // New message or received offer with a conversation → open the chat drawer.
        if (
            (notification.type === 'message_received' || notification.type === 'offer_received' || notification.type === 'offer_rejected') &&
            notification.conversationId
        ) {
            window.dispatchEvent(
                new CustomEvent('cardverse:open-chat', {
                    detail: { conversationId: notification.conversationId },
                }),
            );
            return;
        }

        // Fallback: the card detail page.
        if (notification.cardId) {
            router.push(`/cards/${notification.cardId}`);
        }
    };

    // Mark all as read
    const markAllAsRead = async () => {
        const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
        if (unreadIds.length === 0) return;

        await supabase
            .from('notifications')
            .update({ read: true } as never)
            .in('id', unreadIds);

        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const unreadCount = notifications.filter((n) => !n.read).length;

    useEffect(() => {
        if (originalTitleRef.current === null) originalTitleRef.current = document.title;
        if (unreadCount > 0) {
            document.title = copy.unreadTitle.replace('{count}', String(unreadCount));
        } else if (originalTitleRef.current) {
            document.title = originalTitleRef.current;
        }
        return () => {
            if (originalTitleRef.current) document.title = originalTitleRef.current;
        };
    }, [copy.unreadTitle, unreadCount]);

    const getNotificationIcon = (type: Notification["type"]) => {
        switch (type) {
            case "offer_received":
                return <Tag className="h-4 w-4 text-blue-500" />;
            case "offer_accepted":
                return <CheckCircle className="h-4 w-4 text-green-500" />;
            case "offer_rejected":
                return <Tag className="h-4 w-4 text-red-500" />;
            case "card_sold":
                return <Package className="h-4 w-4 text-green-500" />;
            case "message_received":
                return <MessageCircle className="h-4 w-4 text-orange-500" />;
            default:
                return <Bell className="h-4 w-4" />;
        }
    };

    if (!user) {
        return (
            <Button variant="ghost" size="icon" disabled>
                <Bell className="h-4 w-4" />
            </Button>
        );
    }

    return (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                    <Bell className={`h-4 w-4 ${isRinging ? 'animate-bell-ring' : ''}`} />
                    {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                            {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="flex items-center justify-between">
                    <span>{copy.title}</span>
                    {unreadCount > 0 && (
                        <Button variant="ghost" size="sm" className="text-xs h-6" onClick={markAllAsRead}>
                            {copy.markAllRead}
                        </Button>
                    )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {browserPermission === 'default' && (
                    <>
                        <DropdownMenuItem
                            onSelect={(event) => {
                                event.preventDefault();
                                void requestBrowserNotifications();
                            }}
                            className="cursor-pointer text-sm"
                        >
                            <Bell className="mr-2 h-4 w-4 text-orange-500" />
                            {copy.enableBrowser}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}
                {browserPermission === 'denied' && (
                    <>
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                            {copy.browserBlocked}
                        </div>
                        <DropdownMenuSeparator />
                    </>
                )}
                {notifications.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground text-sm">
                        {copy.empty}
                    </div>
                ) : (
                    <div className="max-h-80 overflow-y-auto">
                        {notifications.slice(0, 10).map((notification) => (
                            <DropdownMenuItem
                                key={notification.id}
                                className={`flex items-start gap-3 p-3 cursor-pointer ${!notification.read ? "bg-primary/5" : ""
                                    }`}
                                onClick={() => handleNotificationClick(notification)}
                            >
                                <div className="flex-shrink-0 mt-0.5">
                                    {getNotificationIcon(notification.type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm ${!notification.read ? "font-medium" : ""}`}>
                                        {notification.title}
                                    </p>
                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                        {notification.message}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {formatDistanceToNow(new Date(notification.createdAt), {
                                            addSuffix: true,
                                            locale: distanceLocale,
                                        })}
                                    </p>
                                </div>
                                {!notification.read && (
                                    <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                                )}
                            </DropdownMenuItem>
                        ))}
                    </div>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
