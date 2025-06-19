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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
// for cross origin resource sharing
// this is to allow the frontend to access the backend
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

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
// const paymentRoutes = require('./routes/paymentRoute');

// Add after other requires
const { scheduleLectureUpdates } = require('./lib/lectureScheduler');

// middleware
app.use(bodyParser.json());
app.use(morgan('tiny'));
app.use(`${api}/user`, userRouter);
app.use(`${api}/post`, postRouter);
app.use(`${api}/comment`, commentRouter);
app.use(`${api}/setting`, settingRouter);
app.use(`${api}/transaction`, transactionRouter);
app.use(`${api}/admin`, adminRoutes);
app.use(`${api}/lecture`, lectureRouter);
app.use(`${api}/enrollment`, enrollmentRouter);

// this rout section is for payment gate-way integration logic
// app.use(`${api}/user/`, paymentRouter);
app.use(`${api}/payment`, paymentRouter);
app.use(`${api}/user_info`, userInfoRouter);
app.use(`${api}/assets`, AssetRouter);
app.use(`${api}/contactMessage`, contactMessageRouter);

// Initialize scheduler
scheduleLectureUpdates();

// database connections
mongoose.connect(CONNECT_DB).then(() =>{
    // to check if the database is connected 
    console.log('Connected to db');
}).catch((err) => {
    // to display the error if the connection fails to 
    console.log(err);
})



// starting the server for backend
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(api);
    console.log(`server is running at port ${PORT}`);
});