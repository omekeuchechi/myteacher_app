// all required packages for development
const express = require('express');
const app = express();
const { default: mongoose } = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
require('dotenv').config();
const session = require('express-session');
const passport = require('passport');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
require('./passport');

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: 'https://myteacher.institute' /*'http://localhost:5173'*/,
    credentials: true
  }
});

// Initialize WebRTC Service
const WebRTCService = require('./services/webrtcService');
new WebRTCService(io, {
  // Optional: set max participants per room
  maxParticipants: 100, 
  rateLimit: {
    // 1 minute it is counting in milliseconds
    windowMs: 60000,
    // Max 100 events per minute per socket so that i can prevent rate limiting of bad intention  users
    max: 100 
  }
});

// +++++++++++++++ Increase limit for JSON parsing +++++++++++++++
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ limit: '1000mb', extended: true }));

// +++++++++++++++ Session Configuration +++++++++++++++
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// +++++++++++++++ CORS Configuration +++++++++++++++
app.use(cors({
  origin: 'https://myteacher.institute' /*'http://localhost:5173'*/,
  credentials: true
}));

// +++++++++++++++ Logging incoming requests +++++++++++++++
app.use((req, res, next) => {
  console.log('Incoming request:', {
    method: req.method,
    url: req.url,
    origin: req.headers.origin
  });
  next();
});

// +++++++++++++++ API URL +++++++++++++++
const api = process.env.API_URL;

// +++++++++++++++ Database Connection +++++++++++++++
const CONNECT_DB = process.env.DATABASE_CONN;



// +++++++++++++++ Routers +++++++++++++++
const userRouter = require('./routes/user');
const paymentRouter = require('./routes/payment');
const postRouter = require('./routes/post');
const commentRouter = require('./routes/comment');
const settingRouter = require('./routes/setting');
const userInfoRouter = require('./routes/user_info');
const transactionRouter = require('./routes/transaction');
const { router: adminRoutes } = require('./routes/admin');
const enrollmentRouter = require('./routes/enrollment');
const lectureRouter = require('./routes/lecture');
const AssetRouter = require('./routes/asset');
const contactMessageRouter = require('./routes/contactMessage');
const mailerRouter = require('./routes/mailer');
const socialRoutes = require('./routes/social');
const assignmentRoutes = require('./routes/assignment');
const certificateRoutes = require('./routes/certificate');
const videoRouter = require('./routes/video');
const uploaderRouter = require('./routes/uploader');
const upcomingLectureBatchRouter = require('./routes/upcomingLectureBatch');
const onsiteAssetRoutes = require('./routes/onsite-asset');
const onboardingRouter = require('./routes/onboarding');
const courseRouter = require('./routes/course');
const instructorApplicationRouter = require('./routes/instructorApplication');
const privateTutorRoutes = require('./routes/privateTutor');
const { router: instructorRouter, refreshAllCounts } = require('./routes/instructor');
refreshAllCounts();


// +++++++++++++++ Schedulers +++++++++++++++
const { scheduleLectureUpdates } = require('./lib/lectureScheduler');
const { scheduleAIGrading } = require('./lib/cronJob');
const { scheduleLectureReminders } = require('./lib/lectureReminder');

// +++++++++++++++ Middleware +++++++++++++++
app.use(bodyParser.json());
app.use(morgan('tiny'));
app.use(`/user`, userRouter);
app.use(`/posts`, postRouter);
app.use(`/comments`, commentRouter);
app.use(`/setting`, settingRouter);
app.use(`/transaction`, transactionRouter);
app.use(`/admin`, adminRoutes);
app.use(`/lectures`, lectureRouter);
app.use(`/enrollment`, enrollmentRouter);
app.use(`/payment`, paymentRouter);
app.use(`/user_info`, userInfoRouter);
app.use(`/assets`, AssetRouter);
app.use(`/contactMessage`, contactMessageRouter);
app.use(`/mailer`, mailerRouter);
app.use(`/social`, socialRoutes);
app.use(`/assignments`, assignmentRoutes);
app.use(`/certificates`, certificateRoutes);
app.use(`/video`, videoRouter);
app.use(`/post_files`, uploaderRouter);
app.use(`/upcomingLectureBatch`, upcomingLectureBatchRouter);
app.use(`/onsite-assets`, onsiteAssetRoutes);
app.use(`/onboarding`, onboardingRouter);
app.use(`/courses`, courseRouter);
app.use(`/instructor-applications`, instructorApplicationRouter);
app.use(`/instructor`, instructorRouter);
app.use(`/private-tutor`, privateTutorRoutes);
// +++++++++++++++ Schedulers +++++++++++++++
scheduleLectureUpdates();
scheduleAIGrading();
scheduleLectureReminders();

// +++++++++++++++ html file route ++++++++++++++++++
app.get(`/tutor-request-success`, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'tutor-request-success.html'));
});

// +++++++++++++++ MongoDB connection +++++++++++++++
const mongoOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 30000,
  family: 4,
  retryWrites: true,
  w: 'majority',
  maxPoolSize: 10,
};

const connectWithRetry = async () => {
  try {
    console.log('Attempting to connect to MongoDB...');
    await mongoose.connect(CONNECT_DB, mongoOptions);
    console.log('✅ MongoDB connected successfully');

    if (process.env.NODE_ENV !== 'test') {
      try {
        const CertificateScheduler = require('./services/certificateScheduler');
        CertificateScheduler.start();
      } catch (schedulerError) {
        console.error('❌ Error initializing scheduler:', schedulerError.message);
      }
    }
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.log('Retrying connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  }
};

mongoose.connection.on('error', (err) => console.error('MongoDB connection error:', err));
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Attempting to reconnect...');
  connectWithRetry();
});

connectWithRetry();

// +++++++++++++++ Server +++++++++++++++
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(api);
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server is running on port ${PORT}`);
});

// +++++++++++++++ Error handling +++++++++++++++
server.on('error', (error) => {
  console.error('Server error:', error);
});
