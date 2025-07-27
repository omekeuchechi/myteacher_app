// all required packages for development
//for express is for the app server
const express = require('express');
// for database purpose in other to work with mongodb and also for database connection
const { default: mongoose } = require('mongoose');
const cors = require('cors');
// for middleware purpose
const bodyParser = require('body-parser');
// for output request from the body
const morgan = require('morgan');
// in other to use .env variables in this file
require('dotenv').config();
// storing express to app making app the main focus of this file
const app = express();
// Increase limit to 10mb (or higher if needed)
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ limit: '1000mb', extended: true }));

const session = require('express-session');
const passport = require('passport');
require('./passport'); 

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// Apply CORS middleware with proper configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if the origin is in the allowed list
    const allowedOrigins = [
      'https://myteacher.institute',
      'http://localhost:5173',
      'https://www.myteacher.institute',
      'https://app.myteacher.institute'
    ];

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    console.error('CORS blocked for origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Length', 'Content-Range', 'X-Total-Count'],
  maxAge: 600,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Add request logging (without manual CORS headers)
app.use((req, res, next) => {
  console.log('Incoming request:', {
    method: req.method,
    url: req.url,
    origin: req.headers.origin,
    headers: req.headers
  });
  next();
});

const api = process.env.API_URL;
const CONNECT_DB = process.env.DATABASE_CONN;

// get / post /
// setting the Route and also listeing for http requests of get

// api importation
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
// const paymentRoutes = require('./routes/paymentRoute');

// Add after other requires
const { scheduleLectureUpdates } = require('./lib/lectureScheduler');
const { scheduleAIGrading } = require('./lib/cronJob');

// middleware
app.use(bodyParser.json());
app.use(morgan('tiny'));
app.use(`/user`, userRouter);
app.use(`/posts`, postRouter);
app.use(`/comment`, commentRouter);
app.use(`/setting`, settingRouter);
app.use(`/transaction`, transactionRouter);
app.use(`/admin`, adminRoutes);
app.use(`/lecture`, lectureRouter);
app.use(`/enrollment`, enrollmentRouter);

// this rout section is for payment gate-way integration logic
// app.use(`${api}/user/`, paymentRouter);
app.use(`/payment`, paymentRouter);
app.use(`/user_info`, userInfoRouter);
app.use(`/assets`, AssetRouter);
app.use(`/contactMessage`, contactMessageRouter);
app.use(`/mailer`, mailerRouter);
app.use(`/social`, socialRoutes);
app.use(`/assignments`, assignmentRoutes);
app.use(`/certificates`, certificateRoutes);
app.use(`/video`, videoRouter);
app.use(`/post_files`, uploaderRouter); // Add this line for the uploader route

// Initialize scheduler
scheduleLectureUpdates();
scheduleAIGrading(); // Start the AI grading cron job

// MongoDB connection options
// MongoDB connection options
const mongoOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000, // Increase timeout to 30 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    connectTimeoutMS: 30000, // Increase connection timeout to 30s
    family: 4, // Use IPv4, skip trying IPv6
    retryWrites: true,
    w: 'majority',
    maxPoolSize: 10, // Maximum number of connections in the connection pool
    // Removed serverApi configuration to avoid API versioning issues
};

// Database connection with error handling
const connectWithRetry = async () => {
    try {
        console.log('Attempting to connect to MongoDB...');
        await mongoose.connect(CONNECT_DB, mongoOptions);
        console.log('✅ MongoDB connected successfully');
        
        // Initialize certificate scheduler only after successful DB connection
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

// Handle connection events
mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected. Attempting to reconnect...');
    connectWithRetry();
});

// Initial connection
connectWithRetry();



// starting the server for backend
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(api);
    console.log(`server is running at port ${PORT}`);
});