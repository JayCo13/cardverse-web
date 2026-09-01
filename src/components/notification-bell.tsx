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
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Bell, CheckCircle, MessageCircle, Tag, Package } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { enUS, ja, vi } from "date-fns/locale";
import { useRouter } from "next/navigation";
import { useLocalization } from "@/context/localization-context";
import { localizeSystemNotification } from "@/lib/localized-notifications";

export function NotificationBell() {
    const supabase = useSupabase();
    const { user } = useUser();
    const router = useRouter();
    const { locale, t } = useLocalization();
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
    /**
     * Read before the first paint, not after it.
     *
     * Starting `false` and correcting in an effect meant the mobile layout swapped
     * the whole trigger from a Popover to a Sheet one frame in — React unmounts
     * one tree and mounts the other, so the bell visibly jumped and a tap landing
     * in that window hit a button that no longer existed.
     *
     * Hydration is unaffected: the first render is the signed-out shell below,
     * on the server and in the browser alike, and that shell never reads this.
     */
    const [isMobile, setIsMobile] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
    );
    // The auth provider reads the session synchronously out of the cookie, so
    // the browser's very first render already knows the user while the server's
    // render did not. React does not repair attribute differences on an element
    // it successfully hydrated: the signed-out shell's `disabled` and its
    // missing `relative` stayed welded to the DOM node, which left the bell
    // unclickable and its badge with no positioned ancestor — it fell back to
    // the sticky, full-width <header> and landed in the top-right corner of the
    // viewport. Draw the signed-out shell on the first client pass too, so the
    // signed-in one arrives as an ordinary update that React does apply.
    const [hydrated, setHydrated] = useState(false);
    const [previousUnreadCount, setPreviousUnreadCount] = useState(0);
    const [isRinging, setIsRinging] = useState(false);
    const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');

    // Pre-load audio for better playback
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioUnlockedRef = useRef(false);
    const browserPermissionRef = useRef<NotificationPermission | 'unsupported'>('unsupported');
    const mutedConversationIdsRef = useRef<Set<string>>(new Set());
    const originalTitleRef = useRef<string | null>(null);
    const translateRef = useRef(t);
    useEffect(() => {
        translateRef.current = t;
    }, [t]);

    useEffect(() => {
        setHydrated(true);
    }, []);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(max-width: 639px)');
        const updateIsMobile = () => setIsMobile(mediaQuery.matches);

        updateIsMobile();
        mediaQuery.addEventListener('change', updateIsMobile);
        return () => mediaQuery.removeEventListener('change', updateIsMobile);
    }, []);
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
                orderId: n.order_id,
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
                        orderId: payload.new.order_id,
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
                        // while CardVerseHub is open in a background tab.
                        if (browserPermissionRef.current === 'granted' && document.hidden) {
                            const localized = localizeSystemNotification(newNotification, translateRef.current);
                            const browserNotification = new window.Notification(localized.title, {
                                body: localized.message,
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

                                if (newNotification.type.startsWith('kyc_')) {
                                    window.location.assign('/sell');
                                } else if (newNotification.type === 'offer_accepted' && newNotification.offerId) {
                                    window.location.assign(`/checkout?offerId=${newNotification.offerId}`);
                                } else if (newNotification.type === 'offer_accepted' && newNotification.transactionId) {
                                    window.location.assign(`/transaction/${newNotification.transactionId}`);
                                } else if (newNotification.type.startsWith('order_')) {
                                    if (newNotification.orderId) {
                                        window.location.assign(`/orders/${newNotification.orderId}`);
                                    } else {
                                        const tab = newNotification.type === 'order_new' || newNotification.type === 'order_cancelled' ? 'seller' : 'buyer';
                                        window.location.assign(`/orders?tab=${tab}`);
                                    }
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

        if (notification.type.startsWith('kyc_')) {
            router.push('/sell');
            return;
        }

        if (notification.type === 'withdrawal_completed' || notification.type === 'withdrawal_rejected') {
            router.push('/wallet');
            return;
        }

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

        // Order-related notifications → the order details page. Without an
        // order_id (older notifications) fall back to the orders list on the
        // right tab — "new order"/"cancelled" are seller-side events.
        if (notification.type.startsWith('order_')) {
            if (notification.orderId) {
                router.push(`/orders/${notification.orderId}`);
            } else {
                const tab = notification.type === 'order_new' || notification.type === 'order_cancelled' ? 'seller' : 'buyer';
                router.push(`/orders?tab=${tab}`);
            }
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
            case "withdrawal_rejected":
                return <Bell className="h-4 w-4 text-red-500" />;
            default:
                return <Bell className="h-4 w-4" />;
        }
    };

    if (!user || !hydrated) {
        // Same classes as the signed-in trigger, `relative` included: whichever
        // of the two the DOM node ends up carrying, the badge still has a
        // positioned ancestor to sit on.
        return (
            <Button variant="ghost" size="icon" className="relative" disabled aria-label={copy.title}>
                <Bell className="h-4 w-4" />
            </Button>
        );
    }

    const notificationTrigger = (
        <Button variant="ghost" size="icon" className="relative" aria-label={copy.title}>
            <Bell className={`h-4 w-4 ${isRinging ? 'animate-bell-ring' : ''}`} />
            {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                    {unreadCount > 9 ? "9+" : unreadCount}
                </span>
            )}
        </Button>
    );

    if (isMobile) {
        return (
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
                <SheetTrigger asChild>{notificationTrigger}</SheetTrigger>
                <SheetContent side="bottom" className="max-h-[70vh] w-full overflow-y-auto rounded-t-xl p-0">
                    <div className="flex items-center justify-between border-b px-4 py-3 pr-12">
                        <SheetTitle className="text-base">{copy.title}</SheetTitle>
                        {unreadCount > 0 && (
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={markAllAsRead}>
                                {copy.markAllRead}
                            </Button>
                        )}
                    </div>
                    {browserPermission === 'default' && (
                        <button
                            type="button"
                            onClick={() => void requestBrowserNotifications()}
                            className="flex w-full items-center px-4 py-3 text-left text-sm hover:bg-accent"
                        >
                            <Bell className="mr-2 h-4 w-4 text-orange-500" />
                            {copy.enableBrowser}
                        </button>
                    )}
                    {browserPermission === 'denied' && (
                        <div className="border-b px-4 py-3 text-xs text-muted-foreground">
                            {copy.browserBlocked}
                        </div>
                    )}
                    {notifications.length === 0 ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                            {copy.empty}
                        </div>
                    ) : (
                        <div>
                            {notifications.slice(0, 10).map((notification) => {
                                const localized = localizeSystemNotification(notification, t);
                                return (
                                    <button
                                        key={notification.id}
                                        type="button"
                                        className={`flex w-full items-start gap-3 border-b p-4 text-left ${!notification.read ? "bg-primary/5" : ""}`}
                                        onClick={() => void handleNotificationClick(notification)}
                                    >
                                        <div className="mt-0.5 flex-shrink-0">
                                            {getNotificationIcon(notification.type)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className={`text-sm ${!notification.read ? "font-medium" : ""}`}>
                                                {localized.title}
                                            </p>
                                            <p className="line-clamp-2 text-xs text-muted-foreground">
                                                {localized.message}
                                            </p>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {formatDistanceToNow(new Date(notification.createdAt), {
                                                    addSuffix: true,
                                                    locale: distanceLocale,
                                                })}
                                            </p>
                                        </div>
                                        {!notification.read && (
                                            <div className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                {notificationTrigger}
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
                        {notifications.slice(0, 10).map((notification) => {
                            const localized = localizeSystemNotification(notification, t);
                            return <DropdownMenuItem
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
                                        {localized.title}
                                    </p>
                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                        {localized.message}
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
                            </DropdownMenuItem>;
                        })}
                    </div>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
