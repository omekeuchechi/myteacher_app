// all required packages for development
const express = require('express');
const { default: mongoose } = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const morgan = require('morgan');
require('dotenv').config();
const session = require('express-session');
const passport = require('passport');
require('./passport');

const app = express();

// Increase limit for JSON parsing
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ limit: '1000mb', extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// ----------------- CORS CONFIGURATION -----------------
app.use(cors({
  origin: 'https://myteacher.institute' /*'http://localhost:5173'*/,
  credentials: true
}));

// Logging incoming requests
app.use((req, res, next) => {
  console.log('Incoming request:', {
    method: req.method,
    url: req.url,
    origin: req.headers.origin
  });
  next();
});

const api = process.env.API_URL;
const CONNECT_DB = process.env.DATABASE_CONN;

// Routers
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

const { scheduleLectureUpdates } = require('./lib/lectureScheduler');
const { scheduleAIGrading } = require('./lib/cronJob');
const { scheduleLectureReminders } = require('./lib/lectureReminder');

// Middleware
app.use(bodyParser.json());
app.use(morgan('tiny'));
app.use(`/user`, userRouter);
app.use(`/posts`, postRouter);
app.use(`/comment`, commentRouter);
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

// Initialize schedulers
scheduleLectureUpdates();
scheduleAIGrading();
scheduleLectureReminders();

// MongoDB connection
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

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(api);
  console.log(`server is running at port ${PORT}`);
});
