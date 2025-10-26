const WebSocket = require('ws');

// WebSocket serverini yaratish
// Render avtomatik ravishda PORT muhit o'zgaruvchisini beradi
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const rooms = {}; // xona_id => Set(ws_client)
const clients = new Map(); // ws_client => { roomId: string, resourceId: string }

console.log(`WebSocket signaling server started on port ${PORT}`);

// Yangi ulanish kelganda
wss.on('connection', (ws) => {
    const resourceId = generateUniqueId(); // Har bir ulanish uchun unikal ID
    clients.set(ws, { roomId: null, resourceId: resourceId });
    console.log(`Client connected: ${resourceId}`);

    // Mijozga uning ID'sini yuborish (ixtiyoriy, lekin foydali)
    ws.send(JSON.stringify({ type: 'your-id', userId: resourceId }));

    // Mijozdan xabar kelganda
    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
            console.log(`Message received from ${resourceId}:`, data);
        } catch (e) {
            console.error(`Failed to parse message from ${resourceId}:`, message);
            return;
        }

        const clientData = clients.get(ws);
        if (!clientData) return; // Agar mijoz ma'lumotlari topilmasa

        switch (data.type) {
            case 'join':
                if (data.roomId) {
                    const roomId = data.roomId;
                    clientData.roomId = roomId; // Mijozga xona ID'sini biriktirish

                    // Agar xona mavjud bo'lmasa, yaratish
                    if (!rooms[roomId]) {
                        rooms[roomId] = new Set();
                    }

                    // Eski xonasidan (agar bo'lsa) olib tashlash
                    // removeClientFromOldRoom(ws, clientData, roomId);

                    // Yangi xonaga qo'shish
                    rooms[roomId].add(ws);
                    console.log(`Client ${resourceId} joined room ${roomId}`);

                    // Xonadagi boshqa mijozlarga xabar berish
                    broadcast(roomId, ws, { type: 'user-joined', userId: resourceId });

                    // Yangi mijozga xonadagi boshqa mijozlar haqida xabar berish
                    rooms[roomId].forEach(client => {
                        const otherClientData = clients.get(client);
                        if (client !== ws && otherClientData) {
                            ws.send(JSON.stringify({ type: 'user-joined', userId: otherClientData.resourceId }));
                        }
                    });

                } else {
                     console.warn(`Join message missing roomId from ${resourceId}`);
                }
                break;

            // WebRTC signallari
            case 'offer':
            case 'answer':
            case 'candidate':
                if (data.to && clientData.roomId) {
                    const targetResourceId = data.to; // Maqsadli ID string bo'lishi mumkin
                    const sourceResourceId = clientData.resourceId;
                    const roomId = clientData.roomId;

                    console.log(`Forwarding ${data.type} from ${sourceResourceId} to ${targetResourceId} in room ${roomId}`);

                    // Maqsadli mijozni topish va xabarni yuborish
                    if (rooms[roomId]) {
                        rooms[roomId].forEach(client => {
                             const targetClientData = clients.get(client);
                            if (client !== ws && targetClientData && targetClientData.resourceId == targetResourceId) { // ID ni solishtirish
                                const payload = { ...data }; // Xabarni nusxalash
                                payload.from = sourceResourceId; // Kimdan kelganini qo'shish
                                delete payload.to; // 'to' kerak emas

                                console.log(`Sending ${payload.type} to ${targetResourceId}`);
                                client.send(JSON.stringify(payload));
                            }
                        });
                    } else {
                         console.warn(`Room ${roomId} not found for forwarding.`);
                    }

                } else {
                    console.warn(`Signaling message missing 'to' or sender ${resourceId} not in a room.`);
                }
                break;

            default:
                console.log(`Unknown message type: ${data.type} from ${resourceId}`);
        }
    });

    // Ulanish uzilganda
    ws.on('close', () => {
        const clientData = clients.get(ws);
        if (clientData) {
            const { roomId, resourceId } = clientData;
            console.log(`Client disconnected: ${resourceId}`);

            // Xonadan olib tashlash
            if (roomId && rooms[roomId]) {
                rooms[roomId].delete(ws);
                console.log(`Client ${resourceId} removed from room ${roomId}`);
                // Boshqalarga xabar berish
                broadcast(roomId, ws, { type: 'user-left', userId: resourceId });

                // Agar xona bo'sh qolsa, o'chirish
                if (rooms[roomId].size === 0) {
                    console.log(`Room ${roomId} is empty. Deleting.`);
                    delete rooms[roomId];
                }
            }
            clients.delete(ws); // Mijozlar ro'yxatidan o'chirish
        } else {
             console.log("Unknown client disconnected.");
        }
    });

    // Xatolik yuz berganda
    ws.onerror = (error) => {
        const clientData = clients.get(ws);
        const resourceId = clientData ? clientData.resourceId : 'unknown';
        console.error(`WebSocket error for client ${resourceId}:`, error);
        // Ulanishni yopish (agar avtomatik yopilmagan bo'lsa)
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
    };
});

// Xonadagi barcha mijozlarga (yuboruvchidan tashqari) xabar yuborish
function broadcast(roomId, senderWs, message) {
    if (rooms[roomId]) {
        const messageString = JSON.stringify(message);
        rooms[roomId].forEach(client => {
            if (client !== senderWs && client.readyState === WebSocket.OPEN) {
                const clientData = clients.get(client);
                console.log(`Broadcasting type ${message.type} to ${clientData?.resourceId || 'unknown'}`);
                client.send(messageString);
            }
        });
    }
}

// Unikal ID yaratish (oddiy usul)
function generateUniqueId() {
    return Math.random().toString(36).substring(2, 15);
}

// Mijozni eski xonasidan olib tashlash (agar kerak bo'lsa)
function removeClientFromOldRoom(ws, clientData, newRoomId) {
     if (clientData.roomId && clientData.roomId !== newRoomId && rooms[clientData.roomId]) {
          console.log(`Removing client ${clientData.resourceId} from old room ${clientData.roomId}`);
          rooms[clientData.roomId].delete(ws);
          broadcast(clientData.roomId, ws, { type: 'user-left', userId: clientData.resourceId });
          if (rooms[clientData.roomId].size === 0) {
               console.log(`Old room ${clientData.roomId} is empty. Deleting.`);
               delete rooms[clientData.roomId];
          }
     }
}
