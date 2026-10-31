import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import type { Message, Poll, Room, Topic, TopicComment, UserProfile, WsMessage, WerewolfChatMessage } from './src/types';
import { WerewolfRoomGame } from './serverWerewolf';

interface ClientConnection {
  ws: WebSocket;
  user?: UserProfile;
  roomId?: string;
  lastPing: number;
}

const app = express();
const server = http.createServer(app);
const PORT = 3000;

app.use(express.json());

// Werewolf game state instances by roomId
const werewolfGames = new Map<string, WerewolfRoomGame>();

function getOrCreateWerewolfGame(roomId: string): WerewolfRoomGame {
  let game = werewolfGames.get(roomId);
  if (!game) {
    game = new WerewolfRoomGame(
      roomId,
      (rId) => broadcastWerewolfSync(rId),
      (rId, msg) => broadcastWerewolfChat(rId, msg)
    );
    werewolfGames.set(roomId, game);
  }
  return game;
}

function broadcastWerewolfSync(roomId: string) {
  const game = werewolfGames.get(roomId);
  if (!game) return;
  for (const [ws, client] of clients.entries()) {
    if (client.roomId === roomId && ws.readyState === WebSocket.OPEN) {
      try {
        const syncPayload = game.getClientSync(client.user?.id);
        ws.send(
          JSON.stringify({
            type: 'werewolf_sync',
            payload: syncPayload,
          })
        );
      } catch (err) {
        console.error('Error broadcasting werewolf sync:', err);
      }
    }
  }
}

function broadcastWerewolfChat(roomId: string, msg: WerewolfChatMessage) {
  const game = werewolfGames.get(roomId);
  for (const [ws, client] of clients.entries()) {
    if (client.roomId === roomId && ws.readyState === WebSocket.OPEN) {
      if (msg.channel === 'wolf') {
        const player = game?.players.find((p) => p.id === client.user?.id);
        if (player?.role !== 'werewolf' && game?.phase !== 'game_over') {
          continue;
        }
      }
      if (msg.channel === 'ghost') {
        const player = game?.players.find((p) => p.id === client.user?.id);
        if (player?.isAlive && game?.phase !== 'game_over') {
          continue;
        }
      }

      try {
        ws.send(
          JSON.stringify({
            type: 'werewolf_new_chat',
            payload: msg,
          })
        );
      } catch (err) {
        console.error('Error broadcasting werewolf chat:', err);
      }
    }
  }
}

// Server state (in-memory persistent store for real-time collaboration)
const rooms: Room[] = [
  {
    id: 'chung',
    name: 'Trao Đổi Chung',
    description: 'Nơi mọi người tự do chào hỏi, trao đổi thông tin và kết nối trực tuyến.',
    icon: 'message-square',
    isDefault: true,
    createdAt: Date.now() - 3600000 * 24,
  },
  {
    id: 'ma-soi',
    name: 'Làng Ma Sói Đêm Trăng',
    description: 'Đấu trí Ma Sói thời gian thực: phân vai bí mật, bỏ phiếu ban ngày, kỹ năng ban đêm và sổ tay điều tra.',
    icon: 'moon',
    isDefault: true,
    createdAt: Date.now() - 3600000 * 18,
  },
  {
    id: 'thao-luan',
    name: 'Diễn Đàn Thảo Luận',
    description: 'Chủ đề chuyên sâu, hỏi đáp kinh nghiệm, chia sẻ kiến thức hữu ích.',
    icon: 'help-circle',
    isDefault: true,
    createdAt: Date.now() - 3600000 * 12,
  },
  {
    id: 'y-tuong',
    name: 'Góc Ý Tưởng & Dự Án',
    description: 'Cùng nhau đóng góp ý tưởng, nhận xét giải pháp và tìm đồng đội hợp tác.',
    icon: 'lightbulb',
    isDefault: true,
    createdAt: Date.now() - 3600000 * 8,
  },
  {
    id: 'giai-tri',
    name: 'Góc Thư Giãn',
    description: 'Tâm sự chuyện thường ngày, âm nhạc, sở thích và giải trí.',
    icon: 'coffee',
    isDefault: true,
    createdAt: Date.now() - 3600000 * 4,
  },
];

const messagesByRoom: Record<string, Message[]> = {
  chung: [
    {
      id: 'msg-welcome-1',
      roomId: 'chung',
      senderId: 'sys-bot',
      senderName: 'Hệ Thống',
      senderAvatar: '🤖',
      senderColor: '#3B82F6',
      content: 'Chào mừng các bạn đến với Phòng Trao Đổi Trực Tuyến! Bạn có thể gửi link phòng này cho bạn bè để cùng vào nhắn tin, tạo biểu quyết hoặc đăng chủ đề thảo luận.',
      timestamp: Date.now() - 1000 * 60 * 35,
      reactions: { '👋': ['sys-bot', 'user-guest'], '❤️': ['user-guest'] },
      isPinned: true,
      type: 'announcement',
    },
    {
      id: 'msg-seed-2',
      roomId: 'chung',
      senderId: 'member-minh',
      senderName: 'Minh Tuấn',
      senderAvatar: '👨‍💻',
      senderColor: '#10B981',
      content: 'Mọi người vào phòng thử gửi tin nhắn hoặc thả biểu cảm xem có mượt không nhé!',
      timestamp: Date.now() - 1000 * 60 * 18,
      reactions: { '👍': ['sys-bot'] },
      type: 'text',
    },
    {
      id: 'msg-seed-3',
      roomId: 'chung',
      senderId: 'member-an',
      senderName: 'Lan Anh',
      senderAvatar: '👩‍🎨',
      senderColor: '#8B5CF6',
      content: 'Trang web hiển thị thời gian thực xịn quá, mở 2 tab hoặc gửi điện thoại vào chat cùng lúc được luôn!',
      timestamp: Date.now() - 1000 * 60 * 8,
      replyTo: {
        id: 'msg-seed-2',
        senderName: 'Minh Tuấn',
        content: 'Mọi người vào phòng thử gửi tin nhắn...',
      },
      reactions: { '🔥': ['member-minh'] },
      type: 'text',
    },
  ],
  'ma-soi': [
    {
      id: 'msg-ms-welcome',
      roomId: 'ma-soi',
      senderId: 'sys-narrator',
      senderName: 'Quản Trò Làng',
      senderAvatar: '🐺',
      senderColor: '#DC2626',
      content: 'Chào mừng các dũng sĩ và dân làng đến với Làng Ma Sói Đêm Trăng! Bấm sang tab "Ma Sói 🐺" ở trên để ngồi vào bàn, phân chia vai trò bí mật, bỏ phiếu treo cổ ban ngày và hành động ban đêm.',
      timestamp: Date.now() - 1000 * 60 * 45,
      reactions: { '🌕': ['sys-narrator'], '🐺': ['sys-narrator'] },
      isPinned: true,
      type: 'announcement',
    },
    {
      id: 'msg-ms-tip',
      roomId: 'ma-soi',
      senderId: 'sys-bot',
      senderName: 'Hệ Thống',
      senderAvatar: '💡',
      senderColor: '#3B82F6',
      content: 'Mẹo: Bạn có thể nhấn nút "Thêm người máy (Bot)" để đủ số lượng 6-8 người và bắt đầu ván đấu thử nghiệm ngay lập tức!',
      timestamp: Date.now() - 1000 * 60 * 20,
      reactions: { '👍': ['sys-narrator'] },
      type: 'text',
    },
  ],
  'thao-luan': [
    {
      id: 'msg-tl-1',
      roomId: 'thao-luan',
      senderId: 'sys-bot',
      senderName: 'Hệ Thống',
      senderAvatar: '💡',
      senderColor: '#6366F1',
      content: 'Phòng Thảo Luận: Bạn có thể vừa chat nhanh, vừa đăng các "Chủ đề trao đổi" có bình chọn và bình luận chuyên sâu ở tab bên trên.',
      timestamp: Date.now() - 1000 * 60 * 50,
      reactions: { '💡': ['sys-bot'] },
      isPinned: true,
      type: 'announcement',
    },
  ],
  'y-tuong': [],
  'giai-tri': [],
};

const pollsByRoom: Record<string, Poll[]> = {
  'ma-soi': [
    {
      id: 'poll-ms-1',
      roomId: 'ma-soi',
      question: 'Bạn thích đảm nhận vai trò nào nhất trong Ma Sói?',
      creatorId: 'sys-narrator',
      creatorName: 'Quản Trò Làng',
      createdAt: Date.now() - 1000 * 60 * 60 * 3,
      isActive: true,
      options: [
        { id: 'opt-ms-1', text: '🐺 Ma Sói (Săn mồi & ẩn mình)', votes: ['member-minh'] },
        { id: 'opt-ms-2', text: '🔮 Tiên Tri (Soi thấu chân tướng)', votes: ['member-an'] },
        { id: 'opt-ms-3', text: '🧙‍♀️ Phù Thủy (Nắm giữ sinh tử)', votes: [] },
        { id: 'opt-ms-4', text: '🛡️ Bảo Vệ (Hộ vệ dân làng)', votes: [] },
        { id: 'opt-ms-5', text: '🏹 Thợ Săn (Kéo kẻ địch xuống mồ)', votes: [] },
      ],
    },
  ],
  chung: [
    {
      id: 'poll-1',
      roomId: 'chung',
      question: 'Bạn thường trao đổi nhiều nhất về lĩnh vực nào?',
      creatorId: 'sys-bot',
      creatorName: 'Hệ Thống',
      createdAt: Date.now() - 1000 * 60 * 60 * 2,
      isActive: true,
      options: [
        { id: 'opt-1', text: 'Công nghệ & Lập trình', votes: ['member-minh', 'member-an'] },
        { id: 'opt-2', text: 'Học tập & Ngoại ngữ', votes: [] },
        { id: 'opt-3', text: 'Kinh doanh & Dự án', votes: [] },
        { id: 'opt-4', text: 'Trò chuyện sở thích & Đời sống', votes: ['sys-bot'] },
      ],
    },
  ],
  'thao-luan': [],
  'y-tuong': [],
  'giai-tri': [],
};

const topicsByRoom: Record<string, Topic[]> = {
  'thao-luan': [
    {
      id: 'topic-1',
      roomId: 'thao-luan',
      title: 'Kinh nghiệm quản lý thời gian khi làm việc và học tập từ xa?',
      content: 'Khi tự học hoặc làm việc từ xa, mọi người thường dùng phương pháp hay ứng dụng nào để giữ sự tập trung và trao đổi hiệu quả với đồng đội?',
      authorId: 'member-an',
      authorName: 'Lan Anh',
      authorAvatar: '👩‍🎨',
      authorColor: '#8B5CF6',
      createdAt: Date.now() - 1000 * 60 * 60 * 3,
      tags: ['Kinh nghiệm', 'Học tập', 'Năng suất'],
      upvotes: ['member-minh'],
      commentsCount: 1,
    },
  ],
  chung: [],
  'y-tuong': [
    {
      id: 'topic-2',
      roomId: 'y-tuong',
      title: 'Ý tưởng xây dựng phòng trao đổi trực tuyến không cần đăng ký phức tạp',
      content: 'Chỉ cần một đường link là mọi người có thể vào ngay, đặt tên biệt danh và trò chuyện bảo mật tức thì qua WebSockets.',
      authorId: 'member-minh',
      authorName: 'Minh Tuấn',
      authorAvatar: '👨‍💻',
      authorColor: '#10B981',
      createdAt: Date.now() - 1000 * 60 * 60 * 5,
      tags: ['Sáng kiến', 'WebSockets', 'Trực tuyến'],
      upvotes: ['member-an', 'sys-bot'],
      commentsCount: 0,
      isSolved: true,
    },
  ],
  'giai-tri': [],
};

const topicComments: Record<string, TopicComment[]> = {
  'topic-1': [
    {
      id: 'cmt-1',
      topicId: 'topic-1',
      authorId: 'member-minh',
      authorName: 'Minh Tuấn',
      authorAvatar: '👨‍💻',
      authorColor: '#10B981',
      content: 'Mình thường dùng kỹ thuật Pomodoro (25 phút tập trung + 5 phút nghỉ) kết hợp ghi chú to-do đơn giản, thấy cải thiện năng suất rất rõ rệt!',
      createdAt: Date.now() - 1000 * 60 * 60 * 2,
      upvotes: ['member-an'],
    },
  ],
};

const clients = new Map<WebSocket, ClientConnection>();
const typingStatus = new Map<string, { userId: string; userName: string; roomId: string; timestamp: number }>();

// Clean stale typing status every 3s
setInterval(() => {
  const now = Date.now();
  let changedRooms = new Set<string>();
  for (const [key, item] of typingStatus.entries()) {
    if (now - item.timestamp > 3500) {
      typingStatus.delete(key);
      changedRooms.add(item.roomId);
    }
  }
  for (const roomId of changedRooms) {
    broadcastTyping(roomId);
  }
}, 2000);

interface UserPresenceSession {
  user: UserProfile;
  roomId: string;
  lastSeen: number;
}
const activePresence = new Map<string, UserPresenceSession>();

function getOnlineUsersInRoom(roomId: string): UserProfile[] {
  const now = Date.now();
  const usersMap = new Map<string, UserProfile>();

  // Collect from open WebSockets
  for (const client of clients.values()) {
    if (client.roomId === roomId && client.user) {
      usersMap.set(client.user.id, client.user);
    }
  }

  // Collect from active presence sessions (active within last 15s)
  for (const session of activePresence.values()) {
    if (session.roomId === roomId && now - session.lastSeen < 15000) {
      usersMap.set(session.user.id, session.user);
    }
  }

  return Array.from(usersMap.values());
}

function getAllOnlineUsers(): Array<{ user: UserProfile; roomId: string }> {
  const now = Date.now();
  const allUsersMap = new Map<string, { user: UserProfile; roomId: string }>();

  for (const client of clients.values()) {
    if (client.roomId && client.user) {
      allUsersMap.set(client.user.id, { user: client.user, roomId: client.roomId });
    }
  }

  for (const session of activePresence.values()) {
    if (now - session.lastSeen < 15000) {
      allUsersMap.set(session.user.id, { user: session.user, roomId: session.roomId });
    }
  }

  return Array.from(allUsersMap.values());
}

function getAllOnlineCountsByRoom(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const room of rooms) {
    counts[room.id] = 0;
  }
  const all = getAllOnlineUsers();
  for (const item of all) {
    counts[item.roomId] = (counts[item.roomId] || 0) + 1;
  }
  return counts;
}

function broadcastToRoom(roomId: string, message: WsMessage, excludeWs?: WebSocket) {
  const payloadStr = JSON.stringify(message);
  for (const [ws, client] of clients.entries()) {
    if (ws !== excludeWs && client.roomId === roomId && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payloadStr);
      } catch (err) {
        console.error('Error broadcasting to socket:', err);
      }
    }
  }
}

function broadcastToAll(message: WsMessage) {
  const payloadStr = JSON.stringify(message);
  for (const [ws] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payloadStr);
      } catch (err) {
        console.error('Error broadcasting to all:', err);
      }
    }
  }
}

function broadcastTyping(roomId: string) {
  const activeTyping = Array.from(typingStatus.values()).filter((t) => t.roomId === roomId);
  broadcastToRoom(roomId, {
    type: 'typing_update',
    payload: { typingUsers: activeTyping, roomId },
  });
}

function broadcastPresence(roomId: string) {
  const onlineUsers = getOnlineUsersInRoom(roomId);
  const allOnline = getAllOnlineUsers();
  const allCounts = getAllOnlineCountsByRoom();
  broadcastToAll({
    type: 'presence_update',
    payload: { roomId, users: onlineUsers, allOnline, allCounts },
  });
}

// REST API
app.get('/api/rooms', (req, res) => {
  res.json({
    rooms,
    onlineCounts: getAllOnlineCountsByRoom(),
  });
});

app.post('/api/rooms', (req, res) => {
  const { name, description, icon } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Tên phòng không hợp lệ' });
  }

  const newId = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || `room-${Date.now()}`;

  const existing = rooms.find((r) => r.id === newId);
  const finalId = existing ? `${newId}-${Date.now().toString().slice(-4)}` : newId;

  const newRoom: Room = {
    id: finalId,
    name: name.trim(),
    description: (description || 'Phòng trao đổi cộng đồng mới').trim(),
    icon: icon || 'hash',
    createdAt: Date.now(),
  };

  rooms.push(newRoom);
  messagesByRoom[finalId] = [
    {
      id: `msg-welcome-${finalId}`,
      roomId: finalId,
      senderId: 'sys-bot',
      senderName: 'Hệ Thống',
      senderAvatar: '🎉',
      senderColor: '#3B82F6',
      content: `Phòng "${newRoom.name}" đã được tạo. Hãy bắt đầu trao đổi và chia sẻ liên kết với mọi người!`,
      timestamp: Date.now(),
      reactions: {},
      isPinned: true,
      type: 'announcement',
    },
  ];
  pollsByRoom[finalId] = [];
  topicsByRoom[finalId] = [];

  broadcastToAll({
    type: 'rooms_list',
    payload: rooms,
  });

  res.status(201).json(newRoom);
});

app.get('/api/rooms/:roomId/state', (req, res) => {
  const { roomId } = req.params;
  const userId = req.query.userId as string | undefined;
  const userName = req.query.userName as string | undefined;
  const userAvatar = req.query.userAvatar as string | undefined;
  const userColor = req.query.userColor as string | undefined;

  const room = rooms.find((r) => r.id === roomId);
  if (!room) {
    return res.status(404).json({ error: 'Phòng không tồn tại' });
  }

  if (userId) {
    let user = usersById.get(userId);
    if (!user && userName) {
      user = {
        id: userId,
        name: userName,
        avatar: userAvatar || '👤',
        color: userColor || '#3B82F6',
        joinedAt: Date.now(),
      };
      usersById.set(userId, user);
    }
    if (user) {
      activePresence.set(userId, { user, roomId, lastSeen: Date.now() });
    }
  }

  const wwGame = getOrCreateWerewolfGame(roomId);

  res.json({
    room,
    messages: messagesByRoom[roomId] || [],
    polls: pollsByRoom[roomId] || [],
    topics: topicsByRoom[roomId] || [],
    onlineUsers: getOnlineUsersInRoom(roomId),
    allOnlineUsers: getAllOnlineUsers(),
    allCounts: getAllOnlineCountsByRoom(),
    werewolfState: wwGame.getClientSync(userId),
    werewolfMessages: wwGame.chatMessages,
  });
});

app.get('/api/topics/:topicId/comments', (req, res) => {
  const { topicId } = req.params;
  res.json({
    comments: topicComments[topicId] || [],
  });
});

// Cache of active users for HTTP fallback
const usersById = new Map<string, UserProfile>();

function processWsData(data: WsMessage, clientInfo: ClientConnection) {
  try {
    switch (data.type) {
    case 'join': {
      const { user, roomId } = data.payload;
      usersById.set(user.id, user);
      activePresence.set(user.id, { user, roomId, lastSeen: Date.now() });
      const prevRoomId = clientInfo.roomId;
      clientInfo.user = user;
      clientInfo.roomId = roomId;

      if (prevRoomId && prevRoomId !== roomId) {
        broadcastPresence(prevRoomId);
      }

      // Ensure room state arrays
      if (!messagesByRoom[roomId]) messagesByRoom[roomId] = [];
      if (!pollsByRoom[roomId]) pollsByRoom[roomId] = [];
      if (!topicsByRoom[roomId]) topicsByRoom[roomId] = [];

      const currentRoom = rooms.find((r) => r.id === roomId) || {
        id: roomId,
        name: roomId,
        description: '',
        icon: 'hash',
        createdAt: Date.now(),
      };

      const wwGame = getOrCreateWerewolfGame(roomId);
      if (roomId === 'ma-soi' && wwGame.phase === 'lobby') {
        wwGame.addPlayer(user);
      }

      // Send full current room state to joining user
      const syncData: WsMessage = {
        type: 'sync_state',
        payload: {
          room: currentRoom,
          messages: messagesByRoom[roomId],
          polls: pollsByRoom[roomId],
          topics: topicsByRoom[roomId],
          onlineUsers: getOnlineUsersInRoom(roomId),
          allOnlineUsers: getAllOnlineUsers(),
          allCounts: getAllOnlineCountsByRoom(),
          werewolfState: wwGame.getClientSync(user.id),
          werewolfMessages: wwGame.chatMessages,
        },
      };
      if (clientInfo.ws && clientInfo.ws.readyState === WebSocket.OPEN) {
        clientInfo.ws.send(JSON.stringify(syncData));
      }

      // Broadcast updated presence to all
      broadcastPresence(roomId);
      break;
    }

        case 'send_message': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const { content, replyTo } = data.payload;
          if (!content || !content.trim()) return;

          const newMsg: Message = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            roomId: clientInfo.roomId,
            senderId: clientInfo.user.id,
            senderName: clientInfo.user.name,
            senderAvatar: clientInfo.user.avatar,
            senderColor: clientInfo.user.color,
            content: content.trim(),
            timestamp: Date.now(),
            replyTo,
            reactions: {},
            type: 'text',
          };

          if (!messagesByRoom[clientInfo.roomId]) {
            messagesByRoom[clientInfo.roomId] = [];
          }
          messagesByRoom[clientInfo.roomId].push(newMsg);

          // Clear typing indicator for this user
          const typingKey = `${clientInfo.user.id}_${clientInfo.roomId}`;
          typingStatus.delete(typingKey);
          broadcastTyping(clientInfo.roomId);

          // Broadcast new message to all participants in this room
          broadcastToRoom(clientInfo.roomId, {
            type: 'new_message',
            payload: newMsg,
          });
          break;
        }

        case 'toggle_reaction': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const { messageId, emoji } = data.payload;
          const roomMsgs = messagesByRoom[clientInfo.roomId];
          if (!roomMsgs) return;

          const msg = roomMsgs.find((m) => m.id === messageId);
          if (!msg) return;

          if (!msg.reactions) msg.reactions = {};
          if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

          const userId = clientInfo.user.id;
          const userIdx = msg.reactions[emoji].indexOf(userId);
          if (userIdx > -1) {
            msg.reactions[emoji].splice(userIdx, 1);
            if (msg.reactions[emoji].length === 0) {
              delete msg.reactions[emoji];
            }
          } else {
            msg.reactions[emoji].push(userId);
          }

          broadcastToRoom(clientInfo.roomId, {
            type: 'reaction_updated',
            payload: {
              messageId,
              reactions: msg.reactions,
            },
          });
          break;
        }

        case 'toggle_pin': {
          if (!clientInfo.roomId) return;
          const { messageId } = data.payload;
          const roomMsgs = messagesByRoom[clientInfo.roomId];
          if (!roomMsgs) return;

          const msg = roomMsgs.find((m) => m.id === messageId);
          if (!msg) return;

          msg.isPinned = !msg.isPinned;
          broadcastToRoom(clientInfo.roomId, {
            type: 'pin_updated',
            payload: {
              messageId,
              isPinned: msg.isPinned,
            },
          });
          break;
        }

        case 'typing': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const { isTyping } = data.payload;
          const key = `${clientInfo.user.id}_${clientInfo.roomId}`;

          if (isTyping) {
            typingStatus.set(key, {
              userId: clientInfo.user.id,
              userName: clientInfo.user.name,
              roomId: clientInfo.roomId,
              timestamp: Date.now(),
            });
          } else {
            typingStatus.delete(key);
          }
          broadcastTyping(clientInfo.roomId);
          break;
        }

        case 'create_poll': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const { question, options } = data.payload;
          if (!question || !options || options.length < 2) return;

          const newPoll: Poll = {
            id: `poll-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            roomId: clientInfo.roomId,
            question: question.trim(),
            creatorId: clientInfo.user.id,
            creatorName: clientInfo.user.name,
            createdAt: Date.now(),
            options: options.map((opt, i) => ({
              id: `opt-${i + 1}-${Date.now()}`,
              text: opt.trim(),
              votes: [],
            })),
            isActive: true,
          };

          if (!pollsByRoom[clientInfo.roomId]) {
            pollsByRoom[clientInfo.roomId] = [];
          }
          pollsByRoom[clientInfo.roomId].unshift(newPoll);

          broadcastToRoom(clientInfo.roomId, {
            type: 'new_poll',
            payload: newPoll,
          });

          // Also announce poll in chat
          const pollAnnouncement: Message = {
            id: `msg-poll-${newPoll.id}`,
            roomId: clientInfo.roomId,
            senderId: 'sys-bot',
            senderName: 'Biểu Quyết Mới',
            senderAvatar: '📊',
            senderColor: '#EC4899',
            content: `Thành viên ${clientInfo.user.name} vừa mở biểu quyết: "${newPoll.question}". Hãy bấm tab "Biểu Quyết" để tham gia bình chọn!`,
            timestamp: Date.now(),
            reactions: { '🗳️': [clientInfo.user.id] },
            type: 'announcement',
          };
          messagesByRoom[clientInfo.roomId].push(pollAnnouncement);
          broadcastToRoom(clientInfo.roomId, {
            type: 'new_message',
            payload: pollAnnouncement,
          });
          break;
        }

        case 'vote_poll': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const { pollId, optionId } = data.payload;
          const polls = pollsByRoom[clientInfo.roomId];
          if (!polls) return;

          const poll = polls.find((p) => p.id === pollId);
          if (!poll || !poll.isActive) return;

          const userId = clientInfo.user.id;
          // Toggle vote in option or switch
          for (const opt of poll.options) {
            const idx = opt.votes.indexOf(userId);
            if (idx > -1) {
              opt.votes.splice(idx, 1);
            }
          }

          const targetOpt = poll.options.find((o) => o.id === optionId);
          if (targetOpt) {
            targetOpt.votes.push(userId);
          }

          broadcastToRoom(clientInfo.roomId, {
            type: 'poll_updated',
            payload: poll,
          });
          break;
        }

        case 'create_topic': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const { title, content, tags } = data.payload;
          if (!title || !content) return;

          const newTopic: Topic = {
            id: `topic-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            roomId: clientInfo.roomId,
            title: title.trim(),
            content: content.trim(),
            authorId: clientInfo.user.id,
            authorName: clientInfo.user.name,
            authorAvatar: clientInfo.user.avatar,
            authorColor: clientInfo.user.color,
            createdAt: Date.now(),
            tags: (tags || []).map((t) => t.trim()).filter(Boolean),
            upvotes: [clientInfo.user.id],
            commentsCount: 0,
          };

          if (!topicsByRoom[clientInfo.roomId]) {
            topicsByRoom[clientInfo.roomId] = [];
          }
          topicsByRoom[clientInfo.roomId].unshift(newTopic);
          topicComments[newTopic.id] = [];

          broadcastToRoom(clientInfo.roomId, {
            type: 'new_topic',
            payload: newTopic,
          });

          // Announce in chat
          const topicNotice: Message = {
            id: `msg-top-${newTopic.id}`,
            roomId: clientInfo.roomId,
            senderId: 'sys-bot',
            senderName: 'Chủ Đề Mới',
            senderAvatar: '📌',
            senderColor: '#8B5CF6',
            content: `${clientInfo.user.name} vừa đăng chủ đề trao đổi mới: "${newTopic.title}". Mời mọi người vào thảo luận!`,
            timestamp: Date.now(),
            reactions: { '💡': [clientInfo.user.id] },
            type: 'announcement',
          };
          messagesByRoom[clientInfo.roomId].push(topicNotice);
          broadcastToRoom(clientInfo.roomId, {
            type: 'new_message',
            payload: topicNotice,
          });
          break;
        }

        case 'vote_topic': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const { topicId } = data.payload;
          const topics = topicsByRoom[clientInfo.roomId];
          if (!topics) return;

          const topic = topics.find((t) => t.id === topicId);
          if (!topic) return;

          const userId = clientInfo.user.id;
          const idx = topic.upvotes.indexOf(userId);
          if (idx > -1) {
            topic.upvotes.splice(idx, 1);
          } else {
            topic.upvotes.push(userId);
          }

          broadcastToRoom(clientInfo.roomId, {
            type: 'topic_updated',
            payload: topic,
          });
          break;
        }

        case 'add_comment': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const { topicId, content } = data.payload;
          if (!content || !content.trim()) return;

          const newCmt: TopicComment = {
            id: `cmt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            topicId,
            authorId: clientInfo.user.id,
            authorName: clientInfo.user.name,
            authorAvatar: clientInfo.user.avatar,
            authorColor: clientInfo.user.color,
            content: content.trim(),
            createdAt: Date.now(),
            upvotes: [],
          };

          if (!topicComments[topicId]) {
            topicComments[topicId] = [];
          }
          topicComments[topicId].push(newCmt);

          // Update comment count on topic
          const topics = topicsByRoom[clientInfo.roomId];
          if (topics) {
            const topic = topics.find((t) => t.id === topicId);
            if (topic) {
              topic.commentsCount = topicComments[topicId].length;
              broadcastToRoom(clientInfo.roomId, {
                type: 'topic_updated',
                payload: topic,
              });
            }
          }

          broadcastToRoom(clientInfo.roomId, {
            type: 'comment_added',
            payload: { comment: newCmt, topicId },
          });
          break;
        }

        case 'werewolf_join_seat': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const game = getOrCreateWerewolfGame(clientInfo.roomId);
          game.addPlayer(clientInfo.user);
          break;
        }

        case 'werewolf_leave_seat': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const game = getOrCreateWerewolfGame(clientInfo.roomId);
          game.removePlayer(clientInfo.user.id);
          break;
        }

        case 'werewolf_add_bots': {
          if (!clientInfo.roomId) return;
          const { count } = data.payload;
          const game = getOrCreateWerewolfGame(clientInfo.roomId);
          game.addBots(count || 6);
          break;
        }

        case 'werewolf_start': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const game = getOrCreateWerewolfGame(clientInfo.roomId);
          game.startGame(clientInfo.user.id);
          break;
        }

        case 'werewolf_reset': {
          if (!clientInfo.roomId) return;
          const game = getOrCreateWerewolfGame(clientInfo.roomId);
          game.resetGame();
          break;
        }

        case 'werewolf_action': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const { action, targetId } = data.payload;
          const game = getOrCreateWerewolfGame(clientInfo.roomId);
          game.handleAction(clientInfo.user.id, action, targetId);
          break;
        }

        case 'werewolf_send_chat': {
          if (!clientInfo.user || !clientInfo.roomId) return;
          const { content, channel } = data.payload;
          const game = getOrCreateWerewolfGame(clientInfo.roomId);
          game.sendChatMessage(clientInfo.user, content, channel);
          break;
        }

        case 'werewolf_next_phase': {
          if (!clientInfo.roomId) return;
          const game = getOrCreateWerewolfGame(clientInfo.roomId);
          game.nextPhase();
          break;
        }

        default:
          break;
      }
  } catch (err) {
    console.warn('Error processing action:', err);
  }
}

// HTTP Fallback Endpoint for seamless operation when WebSocket is blocked
app.post('/api/ws-fallback', (req, res) => {
  try {
    const data = req.body as WsMessage;
    if (!data || !data.type) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    let user: UserProfile | undefined;
    let roomId: string | undefined;

    if ('user' in (data as any).payload && (data as any).payload.user) {
      user = (data as any).payload.user;
      usersById.set(user!.id, user!);
    }
    if ('roomId' in (data as any).payload) {
      roomId = (data as any).payload.roomId;
    }
    if (!user && 'userId' in (data as any).payload) {
      user = usersById.get((data as any).payload.userId);
    }

    const clientInfo: ClientConnection = {
      ws: null as any,
      user,
      roomId,
      lastPing: Date.now(),
    };

    if (user && roomId) {
      activePresence.set(user.id, { user, roomId, lastSeen: Date.now() });
    }

    processWsData(data, clientInfo);
    res.json({ ok: true });
  } catch (err) {
    console.warn('Fallback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// WebSocket Server with explicit upgrade routing
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  if (pathname === '/ws' || pathname === '/ws/') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

// Heartbeat to prevent reverse-proxy timeout drops
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client: any) => {
    if (client.isAlive === false) {
      return client.terminate();
    }
    client.isAlive = false;
    client.ping();
  });
}, 25000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

wss.on('connection', (ws: any) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const clientInfo: ClientConnection = {
    ws,
    lastPing: Date.now(),
  };
  clients.set(ws, clientInfo);

  ws.on('message', (raw: any) => {
    try {
      const data = JSON.parse(raw.toString()) as WsMessage;
      clientInfo.lastPing = Date.now();
      processWsData(data, clientInfo);
    } catch (err) {
      console.warn('Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    const roomId = clientInfo.roomId;
    const userId = clientInfo.user?.id;
    if (userId && roomId) {
      typingStatus.delete(`${userId}_${roomId}`);
      broadcastTyping(roomId);
    }
    clients.delete(ws);
    if (roomId) {
      broadcastPresence(roomId);
    }
  });

  ws.on('error', (err: any) => {
    console.warn('Socket connection notice:', err?.message || 'closed');
  });
});

// Start server with Vite middleware integration
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Phòng Trao Đổi server running on port ${PORT}`);
  });
}

startServer();
