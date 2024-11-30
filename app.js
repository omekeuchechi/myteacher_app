const express = require('express');
const { default: mongoose } = require('mongoose');
const bodyParser = require('body-parser');
const morgan = require('morgan');
require('dotenv').config();

const app = express();


const api = process.env.API_URL;
const CONNECT_DB = process.env.DATABASE_CONN;

// get / post /
// setting the Route and also listeing for http requests of get

const userRouter = require('./routes/user');

// middleware
app.use(bodyParser.json());
app.use(morgan('tiny'));
app.use(`${api}/user`, userRouter);


mongoose.connect(CONNECT_DB).then(() =>{
    console.log('Connected to db');
}).catch((err) => {
    console.log(err);
})



// starting the server
app.listen(5000, () => {
    console.log(api);
    // console.log(CONNECT_DB);
    console.log('server is running at port 5000');
})