const jwt = require('jsonwebtoken');
// import { speak } from './../lib/com_voice';
// const { speak } = require('./../lib/com_voice');

const authJs = (req, res, next) => {
    let token = req.header('authorization');

    if(!token){
        return res.status(401).send('Not authorized, no token found');
    }

    token = token.split(" ");

    token = token[1];

    try{
        const decoded = jwt.verify(token, process.env.TOKEN_SECRET_WORD);

        req.decoded = decoded;
        next();
    }catch(error){
        return res.status(500).json({
            message: 'Error occurred',
            error: error
        }), speak;
    }
}

module.exports = authJs;