const EventEmitter = require('events');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const Message = require('../models/message');

class WebRTCService extends EventEmitter {
  constructor(io, options = {}) {
    super();
    this.io = io;
    this.rooms = new Map(); // roomId -> { participants: Set, metadata: Object, connections: Map }
    this.userRooms = new Map(); // socketId -> roomId
    this.userData = new Map(); // socketId -> user metadata
    this.roomLock = new Map(); // roomId -> boolean
    this.screenSharing = new Map(); // roomId -> { userId, streamId }
    this.recordings = new Map(); // recordingId -> { roomId, status, participants: Set }
    this.maxParticipants = options.maxParticipants || 20; // Lowered for better quality
    this.iceServers = options.iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      // Add TURN servers in production
    ];
    this.rateLimit = {
      windowMs: 60000,
      max: 200, // Increased for signaling
      message: 'Too many requests, please try again later',
      ...options.rateLimit
    };
    this.rateLimitCounters = new Map();
    this.setupSocketHandlers();
    this.setupCleanupInterval();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`New connection: ${socket.id}`);
      
      // Setup monitoring and rate limiting
      this.setupConnectionMonitoring(socket);
      this.setupRateLimiting(socket);

      // Existing event handlers...
      socket.on('error', (error) => {
        this.handleError(socket, error, 'socket_error');
      });

      // Join a room with optional user data
      socket.on('join', (data) => {
        const { room, userData } = typeof data === 'string' 
          ? { room: data, userData: {} } 
          : data;
        
        if (!this.validateRoomJoin(socket, room)) return;
        this.handleJoinRoom(socket, room, userData);
      });

      // Handle WebRTC signaling with validation
      socket.on('signal', (data) => this.handleSignal(socket, data));

      // Handle data channel messages
      socket.on('data', (data) => this.handleData(socket, data));

      // Handle room metadata updates
      socket.on('update-room', (metadata) => {
        const roomId = this.userRooms.get(socket.id);
        if (roomId) {
          const room = this.rooms.get(roomId);
          if (room) {
            room.metadata = { ...room.metadata, ...metadata };
            socket.to(roomId).emit('room-updated', { 
              metadata: room.metadata,
              updatedBy: socket.id 
            });
          }
        }
      });

      // Handle user metadata updates
      socket.on('update-user', (userData) => {
        if (this.userRooms.has(socket.id)) {
          this.userData.set(socket.id, { 
            ...this.userData.get(socket.id), 
            ...userData 
          });
          const roomId = this.userRooms.get(socket.id);
          socket.to(roomId).emit('user-updated', {
            userId: socket.id,
            userData: this.userData.get(socket.id)
          });
        }
      });

      // Handle room locking
      socket.on('set-room-lock', ({ locked }) => {
        const roomId = this.userRooms.get(socket.id);
        if (roomId) {
          this.roomLock.set(roomId, !!locked);
          this.io.to(roomId).emit('room-lock-updated', { locked: !!locked });
        }
      });

      // Screen sharing
      socket.on('start-screen-share', (data) => this.handleStartScreenShare(socket, data));
      socket.on('stop-screen-share', () => this.handleStopScreenShare(socket));

      // Media control
      socket.on('mute-audio', () => this.updateMediaState(socket, { audio: false }));
      socket.on('unmute-audio', () => this.updateMediaState(socket, { audio: true }));
      socket.on('stop-video', () => this.updateMediaState(socket, { video: false }));
      socket.on('start-video', () => this.updateMediaState(socket, { video: true }));

      // chating
      socket.on('chat-message', (data) => this.handleChatMessage(socket, data));

      // reacting
      socket.on('react-message', (data) => this.handleReactMessage(socket, data));

      // Editing and deleting messages
      socket.on('edit-message', (data) => this.handleEditMessage(socket, data));
      socket.on('delete-message', (data) => this.handleDeleteMessage(socket, data));

      // Recording
      socket.on('start-recording', () => this.startRecording(socket));
      socket.on('stop-recording', () => this.stopRecording(socket));

      // Handle disconnection
      socket.on('disconnect', () => this.handleDisconnect(socket));
    });
  }

  validateRoomJoin(socket, room) {
    if (!room) {
      socket.emit('error', { message: 'Room ID is required' });
      return false;
    }

    // Check if room is locked
    if (this.roomLock.get(room)) {
      socket.emit('error', { message: 'Room is locked' });
      return false;
    }

    // Check room capacity
    const roomData = this.rooms.get(room);
    if (roomData && roomData.participants.size >= this.maxParticipants) {
      socket.emit('error', { message: 'Room is full' });
      return false;
    }

    return true;
  }

  handleJoinRoom(socket, room, userData) {
    // Leave previous room if any
    this.leaveCurrentRoom(socket);

    // Initialize room if it doesn't exist
    if (!this.rooms.has(room)) {
      this.rooms.set(room, { 
        participants: new Set(),
        connections: new Map(), // Track peer connections
        metadata: { 
          id: room,
          createdAt: new Date().toISOString(),
          createdBy: socket.id,
          type: 'video-meeting',
          settings: {
            videoEnabled: true,
            audioEnabled: true,
            screenSharingEnabled: true,
            recordingEnabled: true,
            maxBitrate: 2500 // kbps
          }
        }
      });
    }

    const roomData = this.rooms.get(room);
    
    // Check room capacity
    if (roomData.participants.size >= this.maxParticipants) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }
    
    // Join room and update data structures
    socket.join(room);
    this.userRooms.set(socket.id, room);
    roomData.participants.add(socket.id);
    
    // Initialize user data with connection metadata
    const userMetadata = {
      id: socket.id,
      joinedAt: new Date().toISOString(),
      lastSeen: Date.now(),
      connectionState: 'connecting',
      reconnectAttempts: 0,
      ...userData,
      mediaState: {
        video: true,
        audio: true,
        screenShare: false
      }
    };
    
    this.userData.set(socket.id, userMetadata);

    // Setup connection monitoring
    this.setupConnectionMonitoring(socket, room);
    
    // Create peer connection with enhanced configuration
    const peerConnection = this.createPeerConnection(room, socket.id);
    roomData.connections.set(socket.id, peerConnection);
    
    // Send initial connection data to client
    this.getIceServers().then(iceServers => {
      socket.emit('connection-info', {
        roomId: room,
        userId: socket.id,
        iceServers: iceServers,
        connectionTimeout: 60000, // 60 seconds
        maxReconnectAttempts: 5,
        reconnectDelay: 1000 // Start with 1 second delay
      });
    });
    
    // Notify other users in the room
    socket.to(room).emit('user-joined', {
      userId: socket.id,
      userData: userMetadata,
      timestamp: new Date().toISOString()
    });

    // Get current participants
    const participants = Array.from(roomData.participants)
      .filter(id => id !== socket.id)
      .map(id => ({
        id,
        userData: this.userData.get(id),
        connectionState: roomData.connections.get(id)?.connectionState || 'new'
      }));

    // Notify the new user about existing participants
    socket.emit('room-joined', { 
      room: {
        ...roomData.metadata,
        participantCount: roomData.participants.size,
        isLocked: this.roomLock.get(room) || false,
        screenSharing: this.screenSharing.get(room) || null
      },
      user: this.userData.get(socket.id),
      participants,
      iceServers: this.iceServers
    });

    this.logConnection(socket.id, `joined room ${room}`);
  }

  createPeerConnection(roomId, userId) {
    const configuration = {
      iceServers: this.iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 10
    };

    // For server-side, we'll just create a minimal object with the necessary methods
    // The actual RTCPeerConnection will be created on the client side
    const pc = {
      connectionState: 'new',
      onicecandidate: null,
      onconnectionstatechange: null,
      ontrack: null,
      close: () => {
        this.logConnection(userId, 'peer connection closed');
      }
    };

    // Store the peer connection in the room
    const room = this.rooms.get(roomId);
    if (room) {
      room.connections.set(userId, pc);
    }

    // Simulate ICE candidates (handled by client)
    setTimeout(() => {
      if (pc.onicecandidate) {
        pc.onicecandidate({ candidate: null });
      }
    }, 100);

    return pc;
  }

  handleStartScreenShare(socket, { streamId, streamType = 'screen' }) {
    const roomId = this.userRooms.get(socket.id);
    if (!roomId) return;

    const userData = this.userData.get(socket.id);
    if (!userData) return;

    // Update user's media state
    userData.mediaState = {
      ...userData.mediaState,
      screenShare: true,
      screenStreamType: streamType
    };
    this.userData.set(socket.id, userData);

    // Store screen sharing info
    this.screenSharing.set(roomId, { 
      userId: socket.id,
      streamId,
      streamType,
      startedAt: new Date().toISOString(),
      userName: userData.name || 'User'
    });

    // Notify room
    this.io.to(roomId).emit('screen-sharing-started', {
      userId: socket.id,
      userName: userData.name || 'User',
      streamId,
      streamType,
      timestamp: new Date().toISOString()
    });

    // Send chat message
    this.io.to(roomId).emit('chat-message', {
      type: 'system',
      message: `${userData.name || 'A user'} started screen sharing`,
      timestamp: new Date().toISOString(),
      userId: 'system',
      userName: 'System',
      metadata: {
        event: 'screen_share_started',
        userId: socket.id,
        userName: userData.name || 'User'
      }
    });
  }

  handleStopScreenShare(socket) {
    const roomId = this.userRooms.get(socket.id);
    if (!roomId) return;

    const screenSharing = this.screenSharing.get(roomId);
    if (!screenSharing || screenSharing.userId !== socket.id) return;

    // Get user data before removing the screen share
    const userData = this.userData.get(socket.id) || {};
    
    // Update user's media state
    if (userData.mediaState) {
      userData.mediaState = {
        ...userData.mediaState,
        screenShare: false,
        screenStreamType: null
      };
      this.userData.set(socket.id, userData);
    }

    // Remove screen sharing state
    this.screenSharing.delete(roomId);

    // Notify room
    this.io.to(roomId).emit('screen-sharing-stopped', {
      userId: socket.id,
      timestamp: new Date().toISOString()
    });

    // Send chat message
    this.io.to(roomId).emit('chat-message', {
      type: 'system',
      message: `${userData.name || 'A user'} stopped screen sharing`,
      timestamp: new Date().toISOString(),
      userId: 'system',
      userName: 'System',
      metadata: {
        event: 'screen_share_stopped',
        userId: socket.id,
        userName: userData.name || 'User',
        duration: screenSharing.startedAt 
          ? Math.round((new Date() - new Date(screenSharing.startedAt)) / 1000) 
          : 0
      }
    });
  }

  updateMediaState(socket, updates) {
    const userId = socket.id;
    const userData = this.userData.get(userId);
    if (!userData) return;

    userData.mediaState = { ...userData.mediaState, ...updates };
    this.userData.set(userId, userData);

    const roomId = this.userRooms.get(userId);
    if (roomId) {
      this.io.to(roomId).emit('user-media-updated', {
        userId,
        mediaState: userData.mediaState
      });
    }
  }

  startRecording(socket) {
    const roomId = this.userRooms.get(socket.id);
    if (!roomId) return;

    const recordingId = `rec_${uuidv4()}`;
    const room = this.rooms.get(roomId);
    
    this.recordings.set(recordingId, {
      roomId,
      status: 'starting',
      startedAt: new Date().toISOString(),
      participants: new Set(room.participants)
    });

    // In a real implementation, you would connect to a media server here
    // to record the streams
    this.io.to(roomId).emit('recording-started', {
      recordingId,
      startedBy: socket.id,
      timestamp: new Date().toISOString()
    });
  }

  stopRecording(socket) {
    const roomId = this.userRooms.get(socket.id);
    if (!roomId) return;

    // Find active recording for this room
    for (const [recordingId, recording] of this.recordings.entries()) {
      if (recording.roomId === roomId && recording.status === 'recording') {
        recording.status = 'stopped';
        recording.stoppedAt = new Date().toISOString();
        
        this.io.to(roomId).emit('recording-stopped', {
          recordingId,
          stoppedBy: socket.id,
          timestamp: recording.stoppedAt,
          duration: new Date(recording.stoppedAt) - new Date(recording.startedAt)
        });
        
        // In a real implementation, process and store the recording here
        
        break;
      }
    }
  }

  handleDisconnect(socket) {
    const roomId = this.userRooms.get(socket.id);
    if (roomId) {
      const room = this.rooms.get(roomId);
      if (room) {
        // Close peer connection
        const pc = room.connections.get(socket.id);
        if (pc) {
          pc.close();
          room.connections.delete(socket.id);
        }

        // Remove from participants
        room.participants.delete(socket.id);

        // Handle screen sharing
        const screenSharing = this.screenSharing.get(roomId);
        if (screenSharing && screenSharing.userId === socket.id) {
          this.screenSharing.delete(roomId);
          this.io.to(roomId).emit('screen-sharing-stopped', {
            userId: socket.id
          });
        }

        // Notify remaining participants
        if (room.participants.size > 0) {
          this.io.to(roomId).emit('user-left', {
            userId: socket.id,
            remainingParticipants: room.participants.size
          });
        } else {
          // Clean up empty room
          this.cleanupRoom(roomId);
        }
      }
    }

    // Clean up user data
    this.userRooms.delete(socket.id);
    this.userData.delete(socket.id);
    this.logConnection(socket.id, 'disconnected');
  }

  cleanupRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Close all peer connections
    for (const [userId, pc] of room.connections) {
      try {
        pc.close();
      } catch (e) {
        console.error(`Error closing peer connection for ${userId}:`, e);
      }
    }

    // Clean up room data
    this.rooms.delete(roomId);
    this.roomLock.delete(roomId);
    this.screenSharing.delete(roomId);
    
    // Clean up any active recordings
    for (const [recordingId, recording] of this.recordings.entries()) {
      if (recording.roomId === roomId) {
        this.recordings.delete(recordingId);
      }
    }
  }

  // Helper Methods
  handleSignal(socket, { targetUserId, signal, type = 'signal' }) {
    if (!targetUserId || !signal) {
      console.error('Invalid signal data:', { targetUserId, signal, type });
      return;
    }

    // Check if target is connected
    if (!this.io.sockets.sockets.has(targetUserId)) {
      socket.emit('error', { 
        message: 'Target user not found',
        targetUserId
      });
      return;
    }

    this.io.to(targetUserId).emit('signal', {
      signal,
      userId: socket.id,
      type,
      timestamp: Date.now()
    });

    if (process.env.NODE_ENV === 'development') {
      console.log(`Signal ${type} from ${socket.id} to ${targetUserId}`);
    }
  }

  handleData(socket, { targetUserIds, data, type = 'message' }) {
    if (!data) return;

    const roomId = this.userRooms.get(socket.id);
    if (!roomId) return;

    const recipients = targetUserIds?.length 
      ? targetUserIds.filter(id => this.io.sockets.sockets.has(id))
      : Array.from(this.rooms.get(roomId)?.participants || [])
          .filter(id => id !== socket.id);

    if (recipients.length === 0) return;

    const message = {
      data,
      type,
      from: socket.id,
      timestamp: Date.now()
    };

    recipients.forEach(recipientId => {
      this.io.to(recipientId).emit('data', message);
    });
  }

  leaveCurrentRoom(socket) {
    const roomId = this.userRooms.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (room) {
      room.participants.delete(socket.id);

      if (room.participants.size === 0) {
        // Clean up empty room
        this.rooms.delete(roomId);
        this.roomLock.delete(roomId);
      } else {
        // Notify other users in the room
        socket.to(roomId).emit('user-left', {
          userId: socket.id 
        });
      }
    }

    this.userRooms.delete(socket.id);
  }

  // Performance & Monitoring
  setupRateLimiting(socket) {
    // Initialize rate limiting for this socket
    socket.rateLimit = {
      count: 0,
      lastReset: Date.now()
    };

    // Middleware for rate limiting
    const rateLimitMiddleware = (event, next) => {
      const now = Date.now();
      const timeSinceReset = now - socket.rateLimit.lastReset;
      
      // Reset counter if window has passed
      if (timeSinceReset > this.rateLimit.windowMs) {
        socket.rateLimit.count = 0;
        socket.rateLimit.lastReset = now;
      }

      // Check if rate limit exceeded
      if (socket.rateLimit.count >= this.rateLimit.max) {
        socket.emit('error', {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
          retryAfter: Math.ceil((this.rateLimit.windowMs - timeSinceReset) / 1000)
        });
        return;
      }

      // Increment counter and proceed
      socket.rateLimit.count++;
      next();
    };

    // Apply middleware to all socket events except specific ones
    const originalEmit = socket.emit;
    socket.emit = function(event, ...args) {
      if (!['pong', 'ping', 'error'].includes(event)) {
        rateLimitMiddleware(event, () => {
          originalEmit.apply(socket, [event, ...args]);
        });
      } else {
        originalEmit.apply(socket, [event, ...args]);
      }
    };
  }

  async getIceServers() {
    try {
      // In production, you would fetch this from your TURN server
      // const response = await fetch('your-turn-server-endpoint');
      // return await response.json();
      
      // Fallback to public STUN servers
      return {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      };
    } catch (error) {
      console.error('Failed to fetch ICE servers:', error);
      // Fallback to public STUN servers
      return {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      };
    }
  }

  handleError(socket, error, context = '') {
    const errorId = uuidv4();
    const timestamp = new Date().toISOString();
    const errorDetails = {
      id: errorId,
      timestamp,
      context,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };

    console.error(`[${timestamp}] Error (${errorId}):`, errorDetails);
    
    // Send error to client
    if (socket && !socket.disconnected) {
      socket.emit('error', {
        id: errorId,
        message: 'An error occurred',
        ...(process.env.NODE_ENV === 'development' && { details: error.message })
      });
    }
  }

  setupConnectionMonitoring(socket, roomId) {
    const TIMEOUT = 60000; // 60 seconds timeout
    const HEARTBEAT_INTERVAL = 10000; // 10 seconds
    
    let isAlive = true;
    let lastPing = Date.now();
    let missedPings = 0;
    const maxMissedPings = 3;

    // Handle heartbeat from client
    const onPing = () => {
      isAlive = true;
      lastPing = Date.now();
      missedPings = 0;
      
      // Update last seen timestamp
      const userData = this.userData.get(socket.id);
      if (userData) {
        userData.lastSeen = Date.now();
        userData.connectionState = 'connected';
      }
    };

    // Check connection status
    const checkConnection = () => {
      const now = Date.now();
      const timeSinceLastPing = now - lastPing;
      
      if (timeSinceLastPing > HEARTBEAT_INTERVAL) {
        missedPings++;
        
        if (missedPings >= maxMissedPings) {
          console.log(`Client ${socket.id} missed ${missedPings} pings, disconnecting...`);
          socket.disconnect(true);
          return;
        }
        
        // Update connection state
        const userData = this.userData.get(socket.id);
        if (userData) {
          userData.connectionState = 'unstable';
          // Notify other users in the room
          socket.to(roomId).emit('user-connection-state', {
            userId: socket.id,
            state: 'unstable',
            timestamp: now
          });
        }
      }
    };

    // Setup event listeners
    socket.on('ping', onPing);
    
    // Send periodic pings to client
    const pingInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('ping');
      }
    }, HEARTBEAT_INTERVAL);
    
    // Check connection status periodically
    const checkInterval = setInterval(checkConnection, HEARTBEAT_INTERVAL);
    
    // Cleanup on disconnect
    const cleanup = () => {
      clearInterval(pingInterval);
      clearInterval(checkInterval);
      socket.off('ping', onPing);
      
      // Update user state
      const userData = this.userData.get(socket.id);
      if (userData) {
        userData.connectionState = 'disconnected';
        userData.lastSeen = Date.now();
      }
      
      // Notify other users in the room
      if (socket.connected) {
        socket.to(roomId).emit('user-connection-state', {
          userId: socket.id,
          state: 'disconnected',
          timestamp: Date.now()
        });
      }
    };
    
    socket.on('disconnect', cleanup);
    socket.on('error', cleanup);
    
    // Initial ping to start the heartbeat
    socket.emit('ping');
  }

  setupCleanupInterval() {
    // Clean up rate limit counters
    setInterval(() => {
      const now = Date.now();
      for (const [key, data] of this.rateLimitCounters.entries()) {
        if (now > data.reset) {
          this.rateLimitCounters.delete(key);
        }
      }
    }, this.rateLimit.windowMs * 2);

    // Log server stats periodically
    if (process.env.NODE_ENV === 'development') {
      setInterval(() => {
        const memoryUsage = process.memoryUsage();
        console.log('Server stats:', {
          rooms: this.rooms.size,
          users: this.userRooms.size,
          memory: {
            rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
            external: `${(memoryUsage.external / 1024 / 1024).toFixed(2)} MB`,
            arrayBuffers: `${(memoryUsage.arrayBuffers / 1024 / 1024).toFixed(2)} MB`
          },
          load: os.loadavg()
        });
      }, 60000); // Every minute
    }
  }

  logConnection(socketId, action) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`User ${socketId} ${action}`);
    }
  }

  // Admin/Management Methods
  getRoomInfo(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      id: roomId,
      participantCount: room.participants.size,
      participants: Array.from(room.participants).map(id => ({
        id,
        userData: this.userData.get(id) || {}
      })),
      metadata: room.metadata || {},
      isLocked: this.roomLock.get(roomId) || false,
      createdAt: room.metadata?.createdAt
    };
  }

  broadcastToRoom(roomId, event, data) {
    if (this.rooms.has(roomId)) {
      this.io.to(roomId).emit(event, data);
      return true;
    }
    return false;
  }

  async handleChatMessage(socket, messageData) {
    const roomId = this.userRooms.get(socket.id);
    if (!roomId) return null;

    const userData = this.userData.get(socket.id) || {};
    
    try {
      const message = new Message({
        roomId,
        content: messageData.message,
        sender: {
          userId: socket.id,
          name: userData.name || 'Anonymous',
          avatar: userData.avatar
        },
        type: messageData.type || 'text',
        status: 'sent',
        metadata: {
          ...messageData.metadata
        },
        ...(messageData.replyTo && { replyTo: messageData.replyTo }),
        ...(messageData.mentions && { mentions: messageData.mentions }),
        ...(messageData.attachments && { attachments: messageData.attachments })
      });

      const savedMessage = await message.save();
      const populatedMessage = await Message.populate(savedMessage, [
        { path: 'mentions', select: 'name avatar' },
        { path: 'replyTo', select: 'content sender.name' },
        { path: 'metadata.deletedBy', select: 'name' }
      ]);

      // Broadcast to room
      this.io.to(roomId).emit('chat-message', populatedMessage.toObject({ virtuals: true }));
      
      return populatedMessage;
    } catch (error) {
      console.error('Error saving message:', error);
      socket.emit('error', { message: 'Failed to send message', error: error.message });
      return null;
    }
  }

  async handleReactMessage(socket, { messageId, reaction }) {
    const roomId = this.userRooms.get(socket.id);
    if (!roomId) return;

    try {
      const message = await Message.findById(messageId);
      if (!message) {
        throw new Error('Message not found');
      }

      // Verify message is in the same room
      if (message.roomId !== roomId) {
        throw new Error('Invalid message');
      }

      await message.addReaction(socket.id, reaction);
      
      // Broadcast the reaction
      this.io.to(roomId).emit('message-reacted', {
        messageId: message._id,
        reaction,
        userId: socket.id,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('Error reacting to message:', error);
      socket.emit('error', { message: 'Failed to react to message', error: error.message });
    }
  }

  async handleEditMessage(socket, { messageId, newContent }) {
    try {
      const message = await Message.findOne({
        _id: messageId,
        'sender.userId': socket.id, // Only allow sender to edit
        'metadata.isDeleted': false
      });

      if (!message) {
        throw new Error('Message not found or unauthorized');
      }

      message.content = newContent;
      await message.save();

      const populatedMessage = await Message.populate(message, [
        { path: 'mentions', select: 'name avatar' },
        { path: 'replyTo', select: 'content sender.name' },
        { path: 'metadata.deletedBy', select: 'name' }
      ]);

      this.io.to(message.roomId).emit('message-edited', populatedMessage.toObject({ virtuals: true }));
      
    } catch (error) {
      console.error('Error editing message:', error);
      socket.emit('error', { message: 'Failed to edit message', error: error.message });
    }
  }

  async handleDeleteMessage(socket, { messageId }) {
    try {
      const message = await Message.findOne({
        _id: messageId,
        'sender.userId': socket.id, // Only allow sender to delete
        'metadata.isDeleted': false
      });

      if (!message) {
        throw new Error('Message not found or unauthorized');
      }

      // Soft delete the message
      await message.softDelete(socket.id);

      this.io.to(message.roomId).emit('message-deleted', {
        messageId: message._id,
        deletedBy: socket.id,
        timestamp: new Date()
      });
      
    } catch (error) {
      console.error('Error deleting message:', error);
      socket.emit('error', { message: 'Failed to delete message', error: error.message });
    }
  }

  async getMessageHistory(roomId, { limit = 50, before } = {}) {
    try {
      return await Message.getRoomMessages(roomId, { limit, before });
    } catch (error) {
      console.error('Error fetching message history:', error);
      throw error;
    }
  }

  // ... [rest of the WebRTCService class]
}

module.exports = WebRTCService;
