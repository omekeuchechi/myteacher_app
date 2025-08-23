const EventEmitter = require('events');

class WebRTCService extends EventEmitter {
  constructor(io) {
    super();
    this.io = io;
    this.rooms = new Map(); // Track active rooms and their participants
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('User connected:', socket.id);
      
      // Join a room
      socket.on('join', (room) => {
        socket.join(room);
        this.rooms.set(socket.id, room);
        console.log(`User ${socket.id} joined room ${room}`);
        
        // Notify other users in the room about new user
        socket.to(room).emit('user-joined', { userId: socket.id });
        
        // Send list of existing users to the new user
        const users = [];
        this.io.sockets.adapter.rooms.get(room)?.forEach(clientId => {
          if (clientId !== socket.id) {
            users.push(clientId);
          }
        });
        socket.emit('existing-users', { users });
      });

      // Handle WebRTC signaling
      socket.on('signal', ({ targetUserId, signal }) => {
        console.log(`Sending signal from ${socket.id} to ${targetUserId}`);
        this.io.to(targetUserId).emit('signal', {
          signal,
          userId: socket.id
        });
      });

      // Handle data channel messages
      socket.on('data', ({ targetUserId, data }) => {
        this.io.to(targetUserId).emit('data', {
          data,
          userId: socket.id
        });
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        const room = this.rooms.get(socket.id);
        if (room) {
          socket.to(room).emit('user-left', { userId: socket.id });
          this.rooms.delete(socket.id);
        }
        console.log('User disconnected:', socket.id);
      });
    });
  }
}

module.exports = WebRTCService;
