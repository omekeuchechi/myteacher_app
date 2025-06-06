// all required packages for development
//for express is for the app server
const express = require('express');
// for database purpose in other to work with mongodb and also for database connection
const { default: mongoose } = require('mongoose');
// for middleware purpose
const bodyParser = require('body-parser');
// for output request from the body
const morgan = require('morgan');
// in other to use .env variables in this file
require('dotenv').config();
// storing express to app making app the main focus of this file
const app = express();


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
// const paymentRoutes = require('./routes/paymentRoute');


// middleware
app.use(bodyParser.json());
app.use(morgan('tiny'));
app.use(`${api}/user`, userRouter);
app.use(`${api}/post`, postRouter);
app.use(`${api}/comment`, commentRouter);
app.use(`${api}/setting`, settingRouter);
app.use(`${api}/transaction`, transactionRouter);

// this rout section is for payment gate-way integration logic
// app.use(`${api}/user/`, paymentRouter);
app.use(`${api}/payment`, paymentRouter);
app.use(`${api}/userInfo`, userInfoRouter);

// database connections
mongoose.connect(CONNECT_DB).then(() =>{
    // to check if the database is connected 🙋‍♀️
    console.log('Connected to db');
}).catch((err) => {
    // to handle the error if the connection fails to 🙆‍♂️
    console.log(err);
})



// starting the server for front end
app.listen(5000, () => {
    console.log(api);
    // console.log(paymentRoute)
    // console.log(CONNECT_DB);
    console.log('server is running at port 5000');
})