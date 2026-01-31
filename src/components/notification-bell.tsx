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
import { Bell, CheckCircle, Tag, Package } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";
import { useRouter } from "next/navigation";

export function NotificationBell() {
    const supabase = useSupabase();
    const { user } = useUser();
    const router = useRouter();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [previousUnreadCount, setPreviousUnreadCount] = useState(0);
    const [isRinging, setIsRinging] = useState(false);

    // Pre-load audio for better playback
    const audioRef = useRef<HTMLAudioElement | null>(null);
    useEffect(() => {
        audioRef.current = new Audio('/assets/notify.wav');
        audioRef.current.load();
    }, []);

    // Fetch and subscribe to notifications for current user
    useEffect(() => {
        if (!user) return;

        // Initial fetch
        const fetchNotifications = async () => {
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) {
                console.error('Error fetching notifications:', error);
                return;
            }

            const notificationsData = data.map(n => ({
                id: n.id,
                userId: n.user_id,
                type: n.type as Notification['type'],
                title: n.title,
                message: n.message,
                cardId: n.card_id,
                offerId: n.offer_id,
                read: n.read,
                createdAt: n.created_at,
            }));

            setNotifications(notificationsData);
            setPreviousUnreadCount(notificationsData.filter(n => !n.read).length);
        };

        fetchNotifications();

        // Subscribe to realtime updates
        const channel = supabase
            .channel('notifications')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${user.id}`,
                },
                (payload) => {
                    const newNotification = {
                        id: payload.new.id,
                        userId: payload.new.user_id,
                        type: payload.new.type as Notification['type'],
                        title: payload.new.title,
                        message: payload.new.message,
                        cardId: payload.new.card_id,
                        offerId: payload.new.offer_id,
                        read: payload.new.read,
                        createdAt: payload.new.created_at,
                    };

                    setNotifications(prev => [newNotification, ...prev]);

                    // Play pre-loaded notification sound
                    if (audioRef.current) {
                        audioRef.current.currentTime = 0;
                        audioRef.current.volume = 0.5;
                        audioRef.current.play().catch(err => console.log('Could not play notification sound:', err));
                    }

                    // Update browser tab title
                    document.title = `Có (1) thông báo mới`;

                    // Trigger bell ringing animation
                    setIsRinging(true);
                    setTimeout(() => setIsRinging(false), 3000);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user]); // supabase is stable singleton

    // Mark notification as read
    const markAsRead = async (notificationId: string) => {
        try {
            await supabase
                .from('notifications')
                .update({ read: true })
                .eq('id', notificationId);

            setNotifications(prev =>
                prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
            );
        } catch (error) {
            console.error("Error marking notification as read:", error);
        }
    };

    // Handle notification click
    const handleNotificationClick = async (notification: Notification) => {
        await markAsRead(notification.id);
        if (notification.cardId) {
            router.push(`/cards/${notification.cardId}`);
        }
        setIsOpen(false);
    };

    // Mark all as read
    const markAllAsRead = async () => {
        const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
        if (unreadIds.length === 0) return;

        await supabase
            .from('notifications')
            .update({ read: true })
            .in('id', unreadIds);

        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const unreadCount = notifications.filter((n) => !n.read).length;

    const getNotificationIcon = (type: Notification["type"]) => {
        switch (type) {
            case "offer_received":
                return <Tag className="h-4 w-4 text-blue-500" />;
            case "offer_accepted":
                return <CheckCircle className="h-4 w-4 text-green-500" />;
            case "card_sold":
                return <Package className="h-4 w-4 text-green-500" />;
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
                    <span>Thông báo</span>
                    {unreadCount > 0 && (
                        <Button variant="ghost" size="sm" className="text-xs h-6" onClick={markAllAsRead}>
                            Đánh dấu đã đọc
                        </Button>
                    )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {notifications.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground text-sm">
                        Không có thông báo
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
                                            locale: vi,
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
