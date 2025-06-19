const jwt = require('jsonwebtoken');

const authJs = (req, res, next) => {
    let token = req.header('authorization');

    if (!token) {
        return res.status(401).send('Not authorized, no token found');
    }

    // Support for "Bearer <token>"
    if (token.startsWith('Bearer ')) {
        token = token.split(' ')[1];
    }

    try {
        const decoded = jwt.verify(token, process.env.TOKEN_SECRET_WORD);
        req.decoded = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            message: 'Invalid or expired token',
            error: error.message
        });
    }
};

module.exports = authJs;